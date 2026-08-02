import { StructuredLogger, type LogSink } from "./logger.js";
import { MetricRegistry } from "./metrics.js";

export interface RuntimeObservabilityOptions {
  clock?: () => Date;
  environment: string;
  releaseSha: string;
  service: string;
  sink?: LogSink;
}

export interface ApiRequestObservation {
  correlationId: string;
  durationMs: number;
  errorCode?: string;
  method: string;
  route: string;
  statusCode: number;
  traceId: string;
}

export interface JobObservation {
  attempt: number;
  correlationId: string;
  durationMs?: number;
  event: string;
  jobId: string;
  queueDelayMs?: number;
  subjectId: string;
  type: string;
}

export interface ProviderObservation {
  cacheOutcome?: string;
  dataClass: string;
  durationMs?: number;
  errorCode?: string;
  event: string;
  operation: string;
  provider: string;
  quotaRemaining?: number;
  requestId: string;
  resultStatus?: string;
  usageCostUnits?: number;
}

export interface AiGenerationObservation {
  costMicros?: number;
  durationMs: number;
  errorCode?: string;
  inputTokens?: number;
  model: string;
  operation: string;
  outcome: "error" | "success";
  outputTokens?: number;
  provider: string;
  requestId?: string;
}

export interface AiQualityObservation {
  correlationId?: string;
  operation: string;
  outcome: "accepted" | "error" | "rejected";
  repairCount: number;
  validationFailureCount: number;
}

export interface AiActionObservation {
  actionCount: number;
  correlationId: string;
  outcome: "cancelled" | "confirmed" | "failed" | "offered";
}

export interface OfflineObservation {
  correlationId: string;
  durationMs: number;
  errorCode?: string;
  outcome: "error" | "success";
  reused?: boolean;
  sizeBytes?: number;
  traceId: string;
}

export interface JobHealthRecord {
  availableAt: Date;
  completedAt?: Date;
  status: string;
  type: string;
}

function statusClass(statusCode: number) {
  return `${Math.floor(statusCode / 100)}xx`;
}

function normalizedErrorCode(errorCode?: string) {
  return errorCode && /^[a-z][a-z0-9_]{0,79}$/.test(errorCode) ? errorCode : "none";
}

export class RuntimeObservability {
  readonly logger: StructuredLogger;
  readonly metrics = new MetricRegistry();
  private readonly clock: () => Date;

  constructor(options: RuntimeObservabilityOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.logger = new StructuredLogger(options);
  }

  apiRequestStarted(
    input: Pick<ApiRequestObservation, "correlationId" | "method" | "route" | "traceId">,
  ) {
    this.logger.log({
      correlationId: input.correlationId,
      event: "request_started",
      level: "info",
      method: input.method,
      operation: input.route,
      route: input.route,
      traceId: input.traceId,
    });
  }

  recordApiRequest(input: ApiRequestObservation) {
    const outcome = input.statusCode >= 500 ? "error" : "success";
    const labels = {
      method: input.method,
      route: input.route,
      status_class: statusClass(input.statusCode),
    };
    this.metrics.increment("roavia_api_requests_total", { ...labels, outcome });
    this.metrics.observe("roavia_api_request_duration_ms", labels, input.durationMs);
    this.logger.log({
      correlationId: input.correlationId,
      durationMs: input.durationMs,
      errorCode: normalizedErrorCode(input.errorCode),
      event: "request_completed",
      level: outcome === "error" ? "error" : "info",
      method: input.method,
      operation: input.route,
      outcome,
      route: input.route,
      statusCode: input.statusCode,
      traceId: input.traceId,
    });
  }

  recordJob(input: JobObservation) {
    this.metrics.increment("roavia_job_events_total", { event: input.event, type: input.type });
    if (input.durationMs !== undefined) {
      this.metrics.observe(
        "roavia_job_duration_ms",
        { event: input.event, type: input.type },
        input.durationMs,
      );
    }
    if (input.queueDelayMs !== undefined) {
      this.metrics.observe("roavia_job_queue_delay_ms", { type: input.type }, input.queueDelayMs);
    }
    this.logger.log({
      attempt: input.attempt,
      correlationId: input.correlationId,
      durationMs: input.durationMs,
      event: input.event,
      jobId: input.jobId,
      level:
        input.event === "dead_lettered"
          ? "error"
          : input.event === "retry_scheduled"
            ? "warn"
            : "info",
      operation: input.type,
      outcome: input.event,
      queueDelayMs: input.queueDelayMs,
      subjectId: input.subjectId,
      type: input.type,
    });
  }

  recordJobHealth(records: readonly JobHealthRecord[], deadLetters: readonly JobHealthRecord[]) {
    this.metrics.reset("roavia_job_queue_depth");
    this.metrics.reset("roavia_job_oldest_age_seconds");
    this.metrics.reset("roavia_job_dead_letters");
    this.metrics.reset("roavia_job_dead_letter_oldest_age_seconds");
    const now = this.clock().getTime();
    const groups = new Map<string, JobHealthRecord[]>();
    for (const record of records) {
      const key = `${record.type}\0${record.status}`;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
    for (const [key, group] of groups) {
      const [type, status] = key.split("\0") as [string, string];
      this.metrics.setGauge("roavia_job_queue_depth", { status, type }, group.length);
      const oldest = Math.max(
        ...group.map((record) => Math.max(0, now - record.availableAt.getTime())),
      );
      this.metrics.setGauge("roavia_job_oldest_age_seconds", { status, type }, oldest / 1_000);
      this.logger.log({
        event: "job_health_snapshot",
        level: "info",
        oldestAgeSeconds: oldest / 1_000,
        operation: type,
        outcome: status,
        queueDepth: group.length,
        type,
      });
    }
    const deadLetterGroups = new Map<string, JobHealthRecord[]>();
    for (const record of deadLetters) {
      deadLetterGroups.set(record.type, [...(deadLetterGroups.get(record.type) ?? []), record]);
    }
    for (const [type, group] of deadLetterGroups) {
      this.metrics.setGauge("roavia_job_dead_letters", { type }, group.length);
      const oldest = Math.max(
        ...group.map((record) =>
          Math.max(0, now - (record.completedAt ?? record.availableAt).getTime()),
        ),
      );
      this.metrics.observe("roavia_job_dead_letter_oldest_age_seconds", { type }, oldest / 1_000);
      this.logger.log({
        deadLetterCount: group.length,
        event: "job_dead_letter_snapshot",
        level: group.length > 0 ? "warn" : "info",
        oldestAgeSeconds: oldest / 1_000,
        operation: type,
        outcome: "dead_lettered",
        type,
      });
    }
  }

  recordProvider(input: ProviderObservation) {
    const status = input.resultStatus ?? "unknown";
    this.metrics.increment("roavia_provider_events_total", {
      error_code: normalizedErrorCode(input.errorCode),
      event: input.event,
      operation: input.operation,
      provider: input.provider,
      status,
    });
    if (input.durationMs !== undefined) {
      this.metrics.observe(
        "roavia_provider_duration_ms",
        { operation: input.operation, provider: input.provider, status },
        input.durationMs,
      );
    }
    if (input.quotaRemaining !== undefined) {
      this.metrics.setGauge(
        "roavia_provider_quota_remaining",
        { operation: input.operation, provider: input.provider },
        input.quotaRemaining,
      );
    }
    if (input.usageCostUnits !== undefined) {
      this.metrics.increment(
        "roavia_provider_usage_cost_units_total",
        { operation: input.operation, provider: input.provider },
        input.usageCostUnits,
      );
    }
    const freshness = input.cacheOutcome === "stale" || status === "stale" ? "stale" : "fresh";
    if (input.event === "cache" || status === "stale") {
      this.metrics.increment("roavia_data_freshness_events_total", {
        data_class: input.dataClass,
        operation: input.operation,
        state: freshness,
      });
    }
    const failure = status === "error" || status === "quota" || status === "unavailable";
    this.logger.log({
      cacheOutcome: input.cacheOutcome,
      correlationId: input.requestId,
      durationMs: input.durationMs,
      errorCode: normalizedErrorCode(input.errorCode),
      event: input.event,
      level: failure ? "warn" : "info",
      operation: input.operation,
      outcome: status,
      provider: input.provider,
      quotaRemaining: input.quotaRemaining,
      usageCostUnits: input.usageCostUnits,
    });
  }

  recordAiGeneration(input: AiGenerationObservation) {
    const labels = { operation: input.operation, outcome: input.outcome, provider: input.provider };
    this.metrics.increment("roavia_ai_generations_total", labels);
    this.metrics.observe("roavia_ai_duration_ms", labels, input.durationMs);
    if (input.costMicros === undefined) {
      this.metrics.increment("roavia_ai_unpriced_generations_total", {
        operation: input.operation,
        provider: input.provider,
      });
    } else {
      this.metrics.increment(
        "roavia_ai_cost_micros_total",
        { operation: input.operation, provider: input.provider },
        input.costMicros,
      );
    }
    if (input.inputTokens !== undefined) {
      this.metrics.increment(
        "roavia_ai_tokens_total",
        { direction: "input", operation: input.operation, provider: input.provider },
        input.inputTokens,
      );
    }
    if (input.outputTokens !== undefined) {
      this.metrics.increment(
        "roavia_ai_tokens_total",
        { direction: "output", operation: input.operation, provider: input.provider },
        input.outputTokens,
      );
    }
    this.logger.log({
      correlationId: input.requestId,
      costMicros: input.costMicros,
      durationMs: input.durationMs,
      errorCode: normalizedErrorCode(input.errorCode),
      event: "ai_generation",
      inputTokens: input.inputTokens,
      level: input.outcome === "error" ? "warn" : "info",
      model: input.model,
      operation: input.operation,
      outcome: input.outcome,
      outputTokens: input.outputTokens,
      provider: input.provider,
    });
  }

  recordAiQuality(input: AiQualityObservation) {
    if (input.validationFailureCount > 0) {
      this.metrics.increment(
        "roavia_ai_validation_failures_total",
        { operation: input.operation, outcome: input.outcome },
        input.validationFailureCount,
      );
    }
    if (input.repairCount > 0) {
      this.metrics.increment(
        "roavia_ai_repairs_total",
        { operation: input.operation, outcome: input.outcome },
        input.repairCount,
      );
    }
    this.logger.log({
      correlationId: input.correlationId,
      event: "ai_quality",
      level: input.outcome === "accepted" ? "info" : "warn",
      operation: input.operation,
      outcome: input.outcome,
      repairCount: input.repairCount,
      validationFailureCount: input.validationFailureCount,
    });
  }

  recordAiAction(input: AiActionObservation) {
    this.metrics.increment(
      "roavia_ai_actions_total",
      { outcome: input.outcome },
      input.actionCount,
    );
    this.logger.log({
      actionCount: input.actionCount,
      correlationId: input.correlationId,
      event: "ai_action",
      level: input.outcome === "failed" ? "warn" : "info",
      operation: "assistant",
      outcome: input.outcome,
    });
  }

  recordOffline(input: OfflineObservation) {
    const reused = input.reused === undefined ? "unknown" : String(input.reused);
    const labels = { outcome: input.outcome, reused };
    this.metrics.increment("roavia_offline_generations_total", labels);
    this.metrics.observe("roavia_offline_generation_duration_ms", labels, input.durationMs);
    this.logger.log({
      correlationId: input.correlationId,
      durationMs: input.durationMs,
      errorCode: normalizedErrorCode(input.errorCode),
      event: "offline_generation",
      level: input.outcome === "error" ? "warn" : "info",
      operation: "offline_package.generate",
      outcome: input.outcome,
      reused: input.reused,
      sizeBytes: input.sizeBytes,
      traceId: input.traceId,
    });
  }
}
