export type LogLevel = "error" | "info" | "warn";
export type LogSink = (line: string, level: LogLevel) => void;

export interface StructuredLogInput {
  actionCount?: number;
  attempt?: number;
  cacheOutcome?: string;
  correlationId?: string;
  costMicros?: number;
  deadLetterCount?: number;
  durationMs?: number;
  errorCode?: string;
  event: string;
  inputTokens?: number;
  jobId?: string;
  level: LogLevel;
  method?: string;
  model?: string;
  operation: string;
  oldestAgeSeconds?: number;
  outcome?: string;
  outputTokens?: number;
  provider?: string;
  queueDelayMs?: number;
  queueDepth?: number;
  quotaRemaining?: number;
  repairCount?: number;
  reused?: boolean;
  route?: string;
  sizeBytes?: number;
  statusCode?: number;
  subjectId?: string;
  traceId?: string;
  type?: string;
  usageCostUnits?: number;
  validationFailureCount?: number;
}

export interface StructuredLoggerOptions {
  clock?: () => Date;
  environment: string;
  releaseSha: string;
  service: string;
  sink?: LogSink;
}

const scalarKeys = new Set<keyof StructuredLogInput>([
  "actionCount",
  "attempt",
  "cacheOutcome",
  "correlationId",
  "costMicros",
  "deadLetterCount",
  "durationMs",
  "errorCode",
  "event",
  "inputTokens",
  "jobId",
  "level",
  "method",
  "model",
  "operation",
  "oldestAgeSeconds",
  "outcome",
  "outputTokens",
  "provider",
  "queueDelayMs",
  "queueDepth",
  "quotaRemaining",
  "repairCount",
  "reused",
  "route",
  "sizeBytes",
  "statusCode",
  "subjectId",
  "traceId",
  "type",
  "usageCostUnits",
  "validationFailureCount",
]);

const sensitiveValuePattern =
  /(?:bearer\s+\S+|sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9]{12,}|eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{4}-\d{2}-\d{2}\b|(?:latitude|longitude|prompt|password|secret|token|notes?)\s*[:=])/i;

function defaultSink(line: string, level: LogLevel) {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function safeString(value: string) {
  const trimmed = value.trim().slice(0, 200);
  return trimmed.length === 0 || sensitiveValuePattern.test(trimmed) ? "[REDACTED]" : trimmed;
}

/** Emits a fixed, content-free schema. Unknown runtime keys are discarded. */
export class StructuredLogger {
  private readonly clock: () => Date;
  private readonly environment: string;
  private readonly releaseSha: string;
  private readonly service: string;
  private readonly sink: LogSink;

  constructor(options: StructuredLoggerOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.environment = safeString(options.environment);
    this.releaseSha = safeString(options.releaseSha);
    this.service = safeString(options.service);
    this.sink = options.sink ?? defaultSink;
  }

  log(input: StructuredLogInput) {
    const record: Record<string, boolean | number | string> = {
      environment: this.environment,
      releaseSha: this.releaseSha,
      service: this.service,
      timestamp: this.clock().toISOString(),
    };
    for (const [rawKey, rawValue] of Object.entries(input)) {
      const key = rawKey as keyof StructuredLogInput;
      if (!scalarKeys.has(key) || rawValue === undefined) continue;
      if (typeof rawValue === "string") record[key] = safeString(rawValue);
      else if (typeof rawValue === "number" && Number.isFinite(rawValue)) record[key] = rawValue;
      else if (typeof rawValue === "boolean") record[key] = rawValue;
    }
    const level = input.level;
    this.sink(JSON.stringify(record), level);
  }
}
