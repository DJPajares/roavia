import { z } from "zod";

import { defaultJobPolicy, defineJob } from "./contracts.js";
import type { JobRecord } from "./contracts.js";
import { cancelledJob, permanentJobFailure, transientJobFailure } from "./errors.js";
import type { JobRuntime } from "./port.js";

export const ITINERARY_GENERATION_JOB_TYPE = "itinerary.generate.v1" as const;

export const itineraryGenerationJobPayloadSchema = z
  .object({
    generationRunId: z.uuid(),
    tripId: z.uuid(),
    tripRevision: z.number().int().positive(),
  })
  .strict();

export type ItineraryGenerationJobPayload = z.infer<typeof itineraryGenerationJobPayloadSchema>;

export interface ItineraryGenerationJobService {
  generate(input: {
    jobAttempt: number;
    maxJobAttempts: number;
    requestId: string;
    runId: string;
    signal: AbortSignal;
    tripId: string;
    tripRevision: number;
  }): Promise<
    | {
        attempts: readonly unknown[];
        repairAttempts: number;
        status: "success";
      }
    | {
        attempts: readonly unknown[];
        error: { code: string; retryable: boolean };
        repairAttempts: number;
        status: "error";
      }
  >;
}

export interface ItineraryGenerationRunQueueStore {
  createRun(input: {
    authUserId: string;
    correlationId: string;
    expectedTripRevision: number;
    maxRepairAttempts?: number;
    promptVersion: string;
    tripId: string;
  }): Promise<{
    correlationId: string;
    maxRepairAttempts: number;
    runId: string;
    status: "queued";
    tripId: string;
    tripRevision: number;
  }>;
  finishFailure(
    runId: string,
    failure: { cancelled: boolean; code: string; terminal: boolean },
  ): Promise<void>;
}

export interface ItineraryGenerationRequestStore<TStatus> extends ItineraryGenerationRunQueueStore {
  getLatestRun(authUserId: string, tripId: string): Promise<TStatus | null>;
}

export interface EnqueueItineraryGenerationInput {
  authUserId: string;
  correlationId: string;
  expectedTripRevision: number;
  maxRepairAttempts?: number;
  promptVersion?: string;
  tripId: string;
}

export interface EnqueuedItineraryGeneration {
  job: JobRecord;
  run: Awaited<ReturnType<ItineraryGenerationRunQueueStore["createRun"]>>;
}

/** Creates product state first, then enqueues its identifier-only job with failure compensation. */
export async function enqueueItineraryGeneration(
  runtime: JobRuntime,
  store: ItineraryGenerationRunQueueStore,
  input: EnqueueItineraryGenerationInput,
): Promise<EnqueuedItineraryGeneration> {
  const run = await store.createRun({
    authUserId: input.authUserId,
    correlationId: input.correlationId,
    expectedTripRevision: input.expectedTripRevision,
    maxRepairAttempts: input.maxRepairAttempts ?? 2,
    promptVersion: input.promptVersion ?? "itinerary-generation-v2",
    tripId: input.tripId,
  });
  try {
    const job = await runtime.enqueue({
      correlationId: run.correlationId,
      idempotencyKey: `itinerary:${run.tripId}:revision:${run.tripRevision}`,
      payload: {
        generationRunId: run.runId,
        tripId: run.tripId,
        tripRevision: run.tripRevision,
      },
      requestedBy: { id: input.authUserId, kind: "user" },
      subjectId: run.tripId,
      type: ITINERARY_GENERATION_JOB_TYPE,
    });
    return { job, run };
  } catch (error) {
    await store.finishFailure(run.runId, {
      cancelled: false,
      code: "enqueue_failed",
      terminal: true,
    });
    throw error;
  }
}

/** Adapts the run store and job runtime to the API's request/status service shape. */
export function createItineraryGenerationRequestService<TStatus>(
  runtime: JobRuntime,
  store: ItineraryGenerationRequestStore<TStatus>,
) {
  return {
    async cancelGeneration(
      authUserId: string,
      tripId: string,
      input: { generationRunId: string; jobId: string },
    ) {
      const job = await runtime.get(input.jobId);
      if (
        !job ||
        job.envelope.type !== ITINERARY_GENERATION_JOB_TYPE ||
        job.envelope.subjectId !== tripId ||
        job.envelope.requestedBy.kind !== "user" ||
        job.envelope.requestedBy.id !== authUserId ||
        job.envelope.payload.generationRunId !== input.generationRunId
      ) {
        return null;
      }
      await runtime.cancel(input.jobId);
      await store.finishFailure(input.generationRunId, {
        cancelled: true,
        code: "cancelled",
        terminal: true,
      });
      return {
        generationRunId: input.generationRunId,
        jobId: input.jobId,
        status: "cancelled" as const,
      };
    },
    getGeneration(authUserId: string, tripId: string): Promise<TStatus | null> {
      return store.getLatestRun(authUserId, tripId);
    },
    async requestGeneration(
      authUserId: string,
      tripId: string,
      input: { expectedTripRevision: number },
      context: { correlationId: string },
    ) {
      const queued = await enqueueItineraryGeneration(runtime, store, {
        authUserId,
        correlationId: context.correlationId,
        expectedTripRevision: input.expectedTripRevision,
        tripId,
      });
      return {
        generationRunId: queued.run.runId,
        jobId: queued.job.envelope.jobId,
        status: "queued" as const,
        tripRevision: queued.run.tripRevision,
      };
    },
  };
}

/** Executes one durable generation run; the payload contains identifiers and an immutable revision only. */
export function createItineraryGenerationJob(service: ItineraryGenerationJobService) {
  const policy = {
    ...defaultJobPolicy,
    concurrency: 2,
    timeoutMs: 2 * 60 * 1_000,
  };
  return defineJob({
    handler: async (payload, envelope, context) => {
      if (payload.tripId !== envelope.subjectId) {
        throw permanentJobFailure(
          "invalid_subject",
          "The itinerary generation payload does not match its job subject.",
        );
      }
      if (context.signal.aborted) throw cancelledJob();
      const result = await service.generate({
        jobAttempt: context.attempt,
        maxJobAttempts: policy.maxAttempts,
        requestId: envelope.correlationId,
        runId: payload.generationRunId,
        signal: context.signal,
        tripId: payload.tripId,
        tripRevision: payload.tripRevision,
      });
      if (context.signal.aborted) throw cancelledJob();
      if (result.status === "error") {
        if (result.error.code === "cancelled") throw cancelledJob();
        if (result.error.retryable) {
          throw transientJobFailure(
            result.error.code,
            "Itinerary generation encountered a retryable failure.",
          );
        }
        throw permanentJobFailure(
          result.error.code,
          "Itinerary generation could not produce a validated draft.",
        );
      }
      return {
        attemptCount: result.attempts.length,
        generationRunId: payload.generationRunId,
        repairAttempts: result.repairAttempts,
        status: "succeeded",
        tripRevision: payload.tripRevision,
      };
    },
    payloadSchema: itineraryGenerationJobPayloadSchema,
    payloadVersion: 1,
    policy,
    type: ITINERARY_GENERATION_JOB_TYPE,
  });
}
