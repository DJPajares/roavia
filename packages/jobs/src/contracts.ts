import { z } from "zod";

import { permanentJobFailure } from "./errors.js";

export const JOB_CONTRACT_VERSION = 1 as const;

export const jobTypeSchema = z.string().regex(/^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$/);
export const idempotencyKeySchema = z.string().min(3).max(300);
export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "retrying",
  "succeeded",
  "cancelled",
  "dead_lettered",
  "discarded",
]);

export const requestedBySchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["user", "system", "operator"]),
});

export const traceContextSchema = z
  .object({
    traceparent: z.string().min(1).max(200),
    tracestate: z.string().max(500).optional(),
  })
  .optional();

export const jobEnvelopeSchema = z.object({
  correlationId: z.uuid(),
  idempotencyKey: idempotencyKeySchema,
  jobId: z.uuid(),
  notBefore: z.iso.datetime({ offset: true }).nullable(),
  payload: z.record(z.string(), z.unknown()),
  payloadVersion: z.number().int().positive(),
  requestedBy: requestedBySchema,
  subjectId: z.string().min(1).max(200),
  traceContext: traceContextSchema,
  type: jobTypeSchema,
});

export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type RequestedBy = z.infer<typeof requestedBySchema>;
export type TraceContext = z.infer<typeof traceContextSchema>;

export const inspectableJobStatuses = [
  "queued",
  "running",
  "retrying",
  "dead_lettered",
] as const satisfies readonly JobStatus[];

export const retryPolicySchema = z
  .object({
    backoffFactor: z.number().min(1).max(10),
    initialDelayMs: z
      .number()
      .int()
      .min(1)
      .max(24 * 60 * 60 * 1_000),
    jitterRatio: z.number().min(0).max(1),
    maxDelayMs: z
      .number()
      .int()
      .min(1)
      .max(24 * 60 * 60 * 1_000),
  })
  .refine((retry) => retry.maxDelayMs >= retry.initialDelayMs, {
    message: "Retry maxDelayMs must be at least initialDelayMs.",
  });

export const jobPolicySchema = z.object({
  concurrency: z.number().int().min(1).max(100),
  deadLetterQueue: jobTypeSchema,
  maxAttempts: z.number().int().min(1).max(100),
  retentionMs: z.number().int().min(1_000),
  retry: retryPolicySchema,
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(24 * 60 * 60 * 1_000),
});

export type RetryPolicy = z.infer<typeof retryPolicySchema>;
export type JobPolicy = z.infer<typeof jobPolicySchema>;

export const defaultJobPolicy: JobPolicy = {
  concurrency: 1,
  deadLetterQueue: "jobs.dead-letter.v1",
  maxAttempts: 3,
  retentionMs: 7 * 24 * 60 * 60 * 1_000,
  retry: {
    backoffFactor: 2,
    initialDelayMs: 1_000,
    jitterRatio: 0.2,
    maxDelayMs: 60_000,
  },
  timeoutMs: 30_000,
};

export interface JobHandlerContext {
  attempt: number;
  signal: AbortSignal;
}

export interface JobDefinition {
  handler: (
    payload: Record<string, unknown>,
    envelope: JobEnvelope,
    context: JobHandlerContext,
  ) => Promise<Record<string, unknown> | void>;
  payloadVersion: number;
  policy: JobPolicy;
  type: string;
  validatePayload: (payload: Record<string, unknown>) => Record<string, unknown>;
}

export function defineJob<TPayload extends Record<string, unknown>>(
  definition: Omit<JobDefinition, "handler" | "validatePayload"> & {
    handler: (
      payload: TPayload,
      envelope: JobEnvelope,
      context: JobHandlerContext,
    ) => Promise<Record<string, unknown> | void>;
    payloadSchema: z.ZodType<TPayload>;
  },
) {
  jobTypeSchema.parse(definition.type);
  if (definition.payloadVersion < 1) throw new Error("Job payloadVersion must be positive.");
  const policy = jobPolicySchema.parse(definition.policy);
  return {
    handler: (
      payload: Record<string, unknown>,
      envelope: JobEnvelope,
      context: JobHandlerContext,
    ) => {
      const parsed = definition.payloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw permanentJobFailure(
          "invalid_payload",
          "Job payload does not satisfy the registered schema.",
        );
      }
      return definition.handler(parsed.data, envelope, context);
    },
    payloadVersion: definition.payloadVersion,
    policy,
    type: definition.type,
    validatePayload: (payload: Record<string, unknown>) => definition.payloadSchema.parse(payload),
  } satisfies JobDefinition;
}

export interface EnqueueJobInput {
  correlationId: string;
  idempotencyKey: string;
  jobId?: string;
  notBefore?: Date;
  payload: Record<string, unknown>;
  requestedBy: RequestedBy;
  subjectId: string;
  traceContext?: TraceContext;
  type: string;
}

export function createJobEnvelope(input: EnqueueJobInput, definition: JobDefinition): JobEnvelope {
  const payload = definition.validatePayload(input.payload);
  return jobEnvelopeSchema.parse({
    ...input,
    jobId: input.jobId ?? crypto.randomUUID(),
    notBefore: input.notBefore?.toISOString() ?? null,
    payload,
    payloadVersion: definition.payloadVersion,
  });
}

export interface JobRecord {
  attempt: number;
  availableAt: Date;
  completedAt?: Date;
  envelope: JobEnvelope;
  errorCode?: string;
  errorSummary?: string;
  originJobId?: string;
  releaseSha?: string;
  result?: Record<string, unknown>;
  startedAt?: Date;
  status: JobStatus;
}

export interface ListJobsInput {
  limit?: number;
  statuses?: JobStatus[];
}

export interface DeadLetterRecord extends JobRecord {
  completedAt: Date;
  errorCode: string;
  errorSummary: string;
  status: "dead_lettered";
}

export interface OperatorAction {
  action: "redrive" | "discard";
  jobId: string;
  operatorId: string;
  reason: string;
  replacementJobId?: string;
}

export type JobTelemetryEvent =
  | "cancelled"
  | "completed"
  | "dead_lettered"
  | "discarded"
  | "enqueued"
  | "redriven"
  | "retry_scheduled"
  | "started";

export interface JobTelemetry {
  attempt: number;
  correlationId: string;
  durationMs?: number;
  event: JobTelemetryEvent;
  jobId: string;
  queueDelayMs?: number;
  subjectId: string;
  timestamp: Date;
  type: string;
}

export type JobTelemetrySink = (event: JobTelemetry) => void | Promise<void>;
