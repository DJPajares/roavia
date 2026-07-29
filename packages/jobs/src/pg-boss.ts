import { desc, eq, inArray, sql } from "drizzle-orm";
import { PgBoss, fromDrizzle, type JobResult, type JobWithMetadata } from "pg-boss";

import {
  applicationJobs,
  createDatabaseClient,
  jobOperatorActions,
  type DatabaseClient,
} from "@roavia/db";

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
import { createJobEnvelope, inspectableJobStatuses, jobEnvelopeSchema } from "./contracts.js";
import { JobExecutionError, cancelledJob, permanentJobFailure } from "./errors.js";
import type { JobRuntime } from "./port.js";

export interface PgBossJobRuntimeOptions {
  applicationName?: string;
  connectionString: string;
  releaseSha?: string;
  telemetry?: JobTelemetrySink;
}

type ApplicationJobRow = typeof applicationJobs.$inferSelect;

export class PgBossJobRuntime implements JobRuntime {
  private readonly boss: PgBoss;
  private readonly database: DatabaseClient;
  private readonly definitions = new Map<string, JobDefinition>();
  private readonly releaseSha?: string;
  private readonly telemetry?: JobTelemetrySink;
  private started = false;

  constructor(options: PgBossJobRuntimeOptions) {
    this.database = createDatabaseClient(options.connectionString);
    this.boss = new PgBoss({
      application_name: options.applicationName ?? "roavia-worker",
      connectionString: options.connectionString,
      createSchema: false,
      migrate: false,
      schema: "jobs",
      schedule: true,
      supervise: true,
    });
    this.releaseSha = options.releaseSha;
    this.telemetry = options.telemetry;
  }

  register(definition: JobDefinition) {
    if (this.started) throw new Error("Job definitions must be registered before startup.");
    if (this.definitions.has(definition.type)) {
      throw new Error(`Job type ${definition.type} is already registered.`);
    }
    this.definitions.set(definition.type, definition);
  }

  async start(options: { workers?: boolean } = {}) {
    if (this.started) return;
    await this.boss.start();
    this.started = true;
    try {
      for (const definition of this.definitions.values()) {
        await this.createQueues(definition);
        if (options.workers !== false) await this.startWorker(definition);
      }
    } catch (error) {
      await this.shutdown();
      throw error;
    }
  }

  async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
    const definition = this.requireDefinition(input.type);
    const envelope = createJobEnvelope(input, definition);

    const row = await this.database.db.transaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(applicationJobs)
        .values({
          correlationId: envelope.correlationId,
          id: envelope.jobId,
          idempotencyKey: envelope.idempotencyKey,
          maxAttempts: definition.policy.maxAttempts,
          notBefore: envelope.notBefore ? new Date(envelope.notBefore) : null,
          payload: envelope.payload,
          payloadVersion: envelope.payloadVersion,
          releaseSha: this.releaseSha,
          requestedById: envelope.requestedBy.id,
          requestedByKind: envelope.requestedBy.kind,
          subjectId: envelope.subjectId,
          type: envelope.type,
        })
        .onConflictDoNothing({ target: applicationJobs.idempotencyKey })
        .returning();

      if (!inserted) {
        const [existing] = await transaction
          .select()
          .from(applicationJobs)
          .where(eq(applicationJobs.idempotencyKey, envelope.idempotencyKey))
          .limit(1);
        if (!existing) throw new Error("Idempotent job reservation could not be read.");
        if (existing.type !== envelope.type || existing.subjectId !== envelope.subjectId) {
          throw new Error("Idempotency key is already reserved for a different job operation.");
        }
        return existing;
      }

      const queueJobId = await this.boss.send(envelope.type, envelope, {
        db: fromDrizzle(transaction, sql),
        deadLetter: definition.policy.deadLetterQueue,
        id: envelope.jobId,
        retryBackoff: true,
        retryDelay: Math.max(1, Math.ceil(definition.policy.retry.initialDelayMs / 1_000)),
        retryDelayMax: Math.max(1, Math.ceil(definition.policy.retry.maxDelayMs / 1_000)),
        retryLimit: definition.policy.maxAttempts - 1,
        singletonKey: envelope.idempotencyKey,
        startAfter: envelope.notBefore ? new Date(envelope.notBefore) : undefined,
      });
      if (!queueJobId) throw new Error("pg-boss rejected a newly reserved job.");
      return inserted;
    });

    const record = this.mapRow(row);
    await this.emit(record, "enqueued");
    return record;
  }

  async get(jobId: string) {
    const [row] = await this.database.db
      .select()
      .from(applicationJobs)
      .where(eq(applicationJobs.id, jobId))
      .limit(1);
    return row ? this.mapRow(row) : undefined;
  }

  async listJobs(input: ListJobsInput = {}) {
    const statuses = input.statuses ?? [...inspectableJobStatuses];
    if (statuses.length === 0) return [];
    const limit = this.requireListLimit(input.limit);
    const rows = await this.database.db
      .select()
      .from(applicationJobs)
      .where(inArray(applicationJobs.status, statuses))
      .orderBy(desc(applicationJobs.updatedAt))
      .limit(limit);
    return rows.map((row) => this.mapRow(row));
  }

  async cancel(jobId: string) {
    const record = await this.requireJobRecord(jobId);
    if (record.status !== "queued" && record.status !== "retrying" && record.status !== "running") {
      throw new Error(`Job ${jobId} cannot be cancelled from ${record.status}.`);
    }
    await this.boss.cancel(record.envelope.type, jobId);
    const [row] = await this.database.db
      .update(applicationJobs)
      .set({ completedAt: new Date(), status: "cancelled", updatedAt: new Date() })
      .where(eq(applicationJobs.id, jobId))
      .returning();
    if (!row) throw new Error(`Job ${jobId} disappeared while cancelling.`);
    const cancelled = this.mapRow(row);
    await this.emit(cancelled, "cancelled");
    return cancelled;
  }

  async listDeadLetters() {
    const rows = await this.database.db
      .select()
      .from(applicationJobs)
      .where(eq(applicationJobs.status, "dead_lettered"))
      .orderBy(desc(applicationJobs.completedAt));
    return rows.map((row) => this.mapDeadLetter(row));
  }

  async redrive(deadLetterJobId: string, operatorId: string, reason: string) {
    this.requireReason(reason);
    const original = await this.requireJobRecord(deadLetterJobId);
    if (original.status !== "dead_lettered") {
      throw new Error(`Job ${deadLetterJobId} is not dead-lettered.`);
    }
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
    await this.database.db.insert(jobOperatorActions).values({
      action: "redrive",
      jobId: deadLetterJobId,
      operatorId,
      reason,
      replacementJobId: replacement.envelope.jobId,
    });
    await this.emit(replacement, "redriven");
    return replacement;
  }

  async discard(deadLetterJobId: string, operatorId: string, reason: string) {
    this.requireReason(reason);
    const original = await this.requireJobRecord(deadLetterJobId);
    if (original.status !== "dead_lettered") {
      throw new Error(`Job ${deadLetterJobId} is not dead-lettered.`);
    }
    const action: OperatorAction = {
      action: "discard",
      jobId: deadLetterJobId,
      operatorId,
      reason,
    };
    await this.database.db.transaction(async (transaction) => {
      await transaction
        .update(applicationJobs)
        .set({ status: "discarded", updatedAt: new Date() })
        .where(eq(applicationJobs.id, deadLetterJobId));
      await transaction.insert(jobOperatorActions).values(action);
    });
    const discarded = await this.requireJobRecord(deadLetterJobId);
    await this.emit(discarded, "discarded");
    return action;
  }

  async shutdown() {
    if (this.started) await this.boss.stop({ close: true, graceful: true, timeout: 30_000 });
    await this.database.close();
    this.started = false;
  }

  private async createQueues(definition: JobDefinition) {
    const retryDelay = Math.max(1, Math.ceil(definition.policy.retry.initialDelayMs / 1_000));
    const retryDelayMax = Math.max(1, Math.ceil(definition.policy.retry.maxDelayMs / 1_000));
    await this.boss.createQueue(definition.policy.deadLetterQueue, {
      deleteAfterSeconds: Math.ceil(definition.policy.retentionMs / 1_000),
      retryLimit: 0,
    });
    await this.boss.createQueue(definition.type, {
      deadLetter: definition.policy.deadLetterQueue,
      deleteAfterSeconds: Math.ceil(definition.policy.retentionMs / 1_000),
      expireInSeconds: Math.max(1, Math.ceil(definition.policy.timeoutMs / 1_000)),
      retryBackoff: true,
      retryDelay,
      retryDelayMax,
      retryLimit: definition.policy.maxAttempts - 1,
    });
  }

  private async startWorker(definition: JobDefinition) {
    const options = {
      includeMetadata: true,
      localConcurrency: definition.policy.concurrency,
      perJobResults: true,
    } as const;
    await this.boss.work<Record<string, unknown>, JobResult[], typeof options>(
      definition.type,
      options,
      async (jobs) => Promise.all(jobs.map((job) => this.executeJob(definition, job))),
    );
  }

  private async executeJob(
    definition: JobDefinition,
    job: JobWithMetadata<Record<string, unknown>>,
  ): Promise<JobResult> {
    const envelope = jobEnvelopeSchema.parse(job.data);
    const attempt = job.retryCount + 1;
    await this.database.db
      .update(applicationJobs)
      .set({ attempt, startedAt: new Date(), status: "running", updatedAt: new Date() })
      .where(eq(applicationJobs.id, envelope.jobId));
    const running = await this.requireJobRecord(envelope.jobId);
    await this.emit(running, "started");

    try {
      if (
        envelope.jobId !== job.id ||
        envelope.type !== definition.type ||
        envelope.payloadVersion !== definition.payloadVersion
      ) {
        throw permanentJobFailure(
          "unsupported_job_contract",
          "Job envelope does not match the registered type and payload version.",
        );
      }
      const result = await definition.handler(envelope.payload, envelope, {
        attempt,
        signal: job.signal,
      });
      if (job.signal.aborted) throw cancelledJob();
      await this.database.db
        .update(applicationJobs)
        .set({
          completedAt: new Date(),
          errorCode: null,
          errorSummary: null,
          result: result ?? {},
          status: "succeeded",
          updatedAt: new Date(),
        })
        .where(eq(applicationJobs.id, envelope.jobId));
      await this.emit(await this.requireJobRecord(envelope.jobId), "completed");
      return { id: job.id, output: result ?? {}, status: "completed" };
    } catch (error) {
      const failure = job.signal.aborted
        ? cancelledJob()
        : error instanceof JobExecutionError
          ? error
          : new JobExecutionError(
              "transient",
              "unhandled_error",
              "Job execution failed unexpectedly.",
            );
      const terminal = failure.kind !== "transient" || attempt >= definition.policy.maxAttempts;
      const status =
        failure.kind === "cancelled" ? "cancelled" : terminal ? "dead_lettered" : "retrying";
      await this.database.db
        .update(applicationJobs)
        .set({
          completedAt: terminal ? new Date() : null,
          errorCode: failure.code,
          errorSummary: failure.message,
          status,
          updatedAt: new Date(),
        })
        .where(eq(applicationJobs.id, envelope.jobId));
      const failed = await this.requireJobRecord(envelope.jobId);
      await this.emit(
        failed,
        failure.kind === "cancelled" ? "cancelled" : terminal ? "dead_lettered" : "retry_scheduled",
      );
      return {
        id: job.id,
        output: { code: failure.code, message: failure.message },
        status: failure.kind === "cancelled" ? "completed" : terminal ? "deadletter" : "failed",
      };
    }
  }

  private mapRow(row: ApplicationJobRow): JobRecord {
    const envelope = jobEnvelopeSchema.parse({
      correlationId: row.correlationId,
      idempotencyKey: row.idempotencyKey,
      jobId: row.id,
      notBefore: row.notBefore?.toISOString() ?? null,
      payload: row.payload,
      payloadVersion: row.payloadVersion,
      requestedBy: { id: row.requestedById, kind: row.requestedByKind },
      subjectId: row.subjectId,
      type: row.type,
    });
    return {
      attempt: row.attempt,
      availableAt: row.notBefore ?? row.createdAt,
      completedAt: row.completedAt ?? undefined,
      envelope,
      errorCode: row.errorCode ?? undefined,
      errorSummary: row.errorSummary ?? undefined,
      releaseSha: row.releaseSha ?? undefined,
      result: row.result ?? undefined,
      startedAt: row.startedAt ?? undefined,
      status: row.status,
    };
  }

  private mapDeadLetter(row: ApplicationJobRow): DeadLetterRecord {
    const record = this.mapRow(row);
    if (
      record.status !== "dead_lettered" ||
      !record.completedAt ||
      !record.errorCode ||
      !record.errorSummary
    ) {
      throw new Error(`Job ${row.id} has incomplete dead-letter metadata.`);
    }
    return {
      ...record,
      completedAt: record.completedAt,
      errorCode: record.errorCode,
      errorSummary: record.errorSummary,
      status: "dead_lettered",
    };
  }

  private async requireJobRecord(jobId: string) {
    const record = await this.get(jobId);
    if (!record) throw new Error(`Job ${jobId} was not found.`);
    return record;
  }

  private requireDefinition(type: string) {
    const definition = this.definitions.get(type);
    if (!definition) throw new Error(`Job type ${type} is not registered.`);
    return definition;
  }

  private requireReason(reason: string) {
    if (reason.trim().length === 0 || reason.length > 500) {
      throw new Error("Operator reason must contain 1 to 500 characters.");
    }
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
      timestamp: new Date(),
      type: record.envelope.type,
    });
  }

  private requireListLimit(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Job inspection limit must be an integer from 1 to 500.");
    }
    return limit;
  }
}
