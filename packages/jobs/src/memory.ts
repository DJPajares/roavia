import type {
  DeadLetterRecord,
  EnqueueJobInput,
  JobDefinition,
  JobRecord,
  JobTelemetryEvent,
  JobTelemetrySink,
  ListJobsInput,
  OperatorAction,
} from "./contracts.js";
import { createJobEnvelope, inspectableJobStatuses } from "./contracts.js";
import { JobExecutionError, cancelledJob, transientJobFailure } from "./errors.js";
import type { JobRuntime } from "./port.js";

export class MemoryJobStore {
  readonly idempotencyKeys = new Map<string, string>();
  readonly operatorActions: OperatorAction[] = [];
  readonly records = new Map<string, JobRecord>();
}

export interface MemoryJobRuntimeOptions {
  clock?: () => Date;
  jitter?: () => number;
  store?: MemoryJobStore;
  telemetry?: JobTelemetrySink;
}

export class MemoryJobRuntime implements JobRuntime {
  readonly store: MemoryJobStore;

  private readonly activeControllers = new Map<string, AbortController>();
  private readonly clock: () => Date;
  private readonly definitions = new Map<string, JobDefinition>();
  private readonly jitter: () => number;
  private readonly telemetry?: JobTelemetrySink;

  constructor(options: MemoryJobRuntimeOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.jitter = options.jitter ?? Math.random;
    this.store = options.store ?? new MemoryJobStore();
    this.telemetry = options.telemetry;
  }

  register(definition: JobDefinition) {
    if (this.definitions.has(definition.type)) {
      throw new Error(`Job type ${definition.type} is already registered.`);
    }
    this.definitions.set(definition.type, definition);
  }

  async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
    const existingId = this.store.idempotencyKeys.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.requireRecord(existingId);
      if (
        existing.envelope.type !== input.type ||
        existing.envelope.subjectId !== input.subjectId
      ) {
        throw new Error("Idempotency key is already reserved for a different job operation.");
      }
      return existing;
    }

    const definition = this.requireDefinition(input.type);
    const envelope = createJobEnvelope(input, definition);
    const record: JobRecord = {
      attempt: 0,
      availableAt: input.notBefore ?? this.clock(),
      envelope,
      status: "queued",
    };

    this.store.idempotencyKeys.set(envelope.idempotencyKey, envelope.jobId);
    this.store.records.set(envelope.jobId, record);
    await this.emit(record, "enqueued");
    return record;
  }

  async get(jobId: string) {
    return this.store.records.get(jobId);
  }

  async listJobs(input: ListJobsInput = {}) {
    const statuses = new Set(input.statuses ?? inspectableJobStatuses);
    const limit = this.requireListLimit(input.limit);
    return [...this.store.records.values()]
      .filter((record) => statuses.has(record.status))
      .toSorted((left, right) => right.availableAt.getTime() - left.availableAt.getTime())
      .slice(0, limit);
  }

  async runNext(type?: string): Promise<JobRecord | undefined> {
    const now = this.clock();
    const record = [...this.store.records.values()]
      .filter(
        (candidate) =>
          (candidate.status === "queued" || candidate.status === "retrying") &&
          candidate.availableAt <= now &&
          (type === undefined || candidate.envelope.type === type),
      )
      .toSorted((left, right) => left.availableAt.getTime() - right.availableAt.getTime())[0];

    if (!record) return undefined;
    await this.execute(record);
    return record;
  }

  async runUntilIdle(maxIterations = 100) {
    const processed: JobRecord[] = [];
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const record = await this.runNext();
      if (!record) break;
      processed.push(record);
    }
    return processed;
  }

  async recoverInterrupted() {
    const recovered: JobRecord[] = [];
    for (const record of this.store.records.values()) {
      if (record.status !== "running") continue;
      record.status = "retrying";
      record.availableAt = this.clock();
      record.errorCode = "worker_interrupted";
      record.errorSummary = "Worker stopped before the job reached a terminal state.";
      recovered.push(record);
      await this.emit(record, "retry_scheduled");
    }
    return recovered;
  }

  async cancel(jobId: string) {
    const record = this.requireRecord(jobId);
    if (record.status === "queued" || record.status === "retrying") {
      record.status = "cancelled";
      record.completedAt = this.clock();
      record.errorCode = "cancelled";
      record.errorSummary = "Job was cancelled before execution.";
      await this.emit(record, "cancelled");
      return record;
    }
    if (record.status === "running") {
      record.status = "cancelled";
      record.completedAt = this.clock();
      this.activeControllers.get(jobId)?.abort(cancelledJob());
      await this.emit(record, "cancelled");
      return record;
    }
    throw new Error(`Job ${jobId} cannot be cancelled from ${record.status}.`);
  }

  async listDeadLetters() {
    return [...this.store.records.values()]
      .filter((record): record is DeadLetterRecord => record.status === "dead_lettered")
      .toSorted((left, right) => right.completedAt.getTime() - left.completedAt.getTime());
  }

  async redrive(deadLetterJobId: string, operatorId: string, reason: string) {
    const original = this.requireRecord(deadLetterJobId);
    if (original.status !== "dead_lettered") {
      throw new Error(`Job ${deadLetterJobId} is not dead-lettered.`);
    }
    this.requireReason(reason);
    const replacementId = crypto.randomUUID();
    const replacement = await this.enqueue({
      correlationId: original.envelope.correlationId,
      idempotencyKey: `${original.envelope.idempotencyKey}:redrive:${replacementId}`,
      jobId: replacementId,
      payload: original.envelope.payload,
      requestedBy: { id: operatorId, kind: "operator" },
      subjectId: original.envelope.subjectId,
      traceContext: original.envelope.traceContext,
      type: original.envelope.type,
    });
    replacement.originJobId = original.envelope.jobId;
    this.store.operatorActions.push({
      action: "redrive",
      jobId: original.envelope.jobId,
      operatorId,
      reason,
      replacementJobId: replacement.envelope.jobId,
    });
    await this.emit(replacement, "redriven");
    return replacement;
  }

  async discard(deadLetterJobId: string, operatorId: string, reason: string) {
    const record = this.requireRecord(deadLetterJobId);
    if (record.status !== "dead_lettered") {
      throw new Error(`Job ${deadLetterJobId} is not dead-lettered.`);
    }
    this.requireReason(reason);
    record.status = "discarded";
    const action: OperatorAction = {
      action: "discard",
      jobId: record.envelope.jobId,
      operatorId,
      reason,
    };
    this.store.operatorActions.push(action);
    await this.emit(record, "discarded");
    return action;
  }

  async shutdown() {
    for (const controller of this.activeControllers.values()) controller.abort(cancelledJob());
    this.activeControllers.clear();
  }

  private async execute(record: JobRecord) {
    const definition = this.requireDefinition(record.envelope.type);
    const controller = new AbortController();
    this.activeControllers.set(record.envelope.jobId, controller);
    record.attempt += 1;
    record.startedAt = this.clock();
    record.status = "running";
    await this.emit(record, "started");

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutFailure = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(transientJobFailure("timeout", "Job exceeded its execution timeout."));
        }, definition.policy.timeoutMs);
      });
      const result = await Promise.race([
        definition.handler(record.envelope.payload, record.envelope, {
          attempt: record.attempt,
          signal: controller.signal,
        }),
        timeoutFailure,
      ]);
      if (controller.signal.aborted) throw cancelledJob();
      record.result = result ?? {};
      record.status = "succeeded";
      record.completedAt = this.clock();
      record.errorCode = undefined;
      record.errorSummary = undefined;
      await this.emit(record, "completed");
    } catch (error) {
      await this.handleFailure(record, definition, error);
    } finally {
      if (timeout) clearTimeout(timeout);
      this.activeControllers.delete(record.envelope.jobId);
    }
  }

  private async handleFailure(record: JobRecord, definition: JobDefinition, error: unknown) {
    const failure =
      error instanceof JobExecutionError
        ? error
        : transientJobFailure("unhandled_error", "Job execution failed unexpectedly.");

    record.errorCode = failure.code;
    record.errorSummary = failure.message;
    if (record.status === "cancelled" || failure.kind === "cancelled") {
      record.status = "cancelled";
      record.completedAt = this.clock();
      await this.emit(record, "cancelled");
      return;
    }

    if (failure.kind === "transient" && record.attempt < definition.policy.maxAttempts) {
      record.status = "retrying";
      record.availableAt = new Date(
        this.clock().getTime() + this.calculateBackoff(definition, record.attempt),
      );
      await this.emit(record, "retry_scheduled");
      return;
    }

    record.status = "dead_lettered";
    record.completedAt = this.clock();
    await this.emit(record, "dead_lettered");
  }

  private calculateBackoff(definition: JobDefinition, attempt: number) {
    const retry = definition.policy.retry;
    const base = Math.min(
      retry.maxDelayMs,
      retry.initialDelayMs * retry.backoffFactor ** Math.max(0, attempt - 1),
    );
    const jitter = base * retry.jitterRatio * (this.jitter() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  private async emit(record: JobRecord, event: JobTelemetryEvent) {
    await this.telemetry?.({
      attempt: record.attempt,
      correlationId: record.envelope.correlationId,
      durationMs:
        record.startedAt && record.completedAt
          ? Math.max(0, record.completedAt.getTime() - record.startedAt.getTime())
          : undefined,
      event,
      jobId: record.envelope.jobId,
      queueDelayMs: record.startedAt
        ? Math.max(0, record.startedAt.getTime() - record.availableAt.getTime())
        : undefined,
      subjectId: record.envelope.subjectId,
      timestamp: this.clock(),
      type: record.envelope.type,
    });
  }

  private requireDefinition(type: string) {
    const definition = this.definitions.get(type);
    if (!definition) throw new Error(`Job type ${type} is not registered.`);
    return definition;
  }

  private requireRecord(jobId: string) {
    const record = this.store.records.get(jobId);
    if (!record) throw new Error(`Job ${jobId} was not found.`);
    return record;
  }

  private requireReason(reason: string) {
    if (reason.trim().length === 0 || reason.length > 500) {
      throw new Error("Operator reason must contain 1 to 500 characters.");
    }
  }

  private requireListLimit(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Job inspection limit must be an integer from 1 to 500.");
    }
    return limit;
  }
}
