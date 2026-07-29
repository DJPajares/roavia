import { describe, expect, test, vi } from "vitest";

import {
  ITINERARY_GENERATION_JOB_TYPE,
  MemoryJobRuntime,
  createItineraryGenerationJob,
  createItineraryGenerationRequestService,
  enqueueItineraryGeneration,
  type ItineraryGenerationJobService,
  type ItineraryGenerationRunQueueStore,
} from "../src/index.js";

const tripId = "10000000-0000-4000-8000-000000000001";
const generationRunId = "20000000-0000-4000-8000-000000000001";
const correlationId = "30000000-0000-4000-8000-000000000001";

function enqueueInput(subjectId = tripId) {
  return {
    correlationId,
    idempotencyKey: `itinerary:${generationRunId}`,
    payload: { generationRunId, tripId, tripRevision: 4 },
    requestedBy: { id: "traveler-test", kind: "user" as const },
    subjectId,
    type: ITINERARY_GENERATION_JOB_TYPE,
  };
}

describe("itinerary generation job", () => {
  test("creates the run and enqueues its identifier-only job", async () => {
    const createRun = vi.fn<ItineraryGenerationRunQueueStore["createRun"]>().mockResolvedValue({
      correlationId,
      maxRepairAttempts: 2,
      runId: generationRunId,
      status: "queued",
      tripId,
      tripRevision: 4,
    });
    const finishFailure = vi.fn<ItineraryGenerationRunQueueStore["finishFailure"]>();
    const runtime = new MemoryJobRuntime();
    runtime.register(
      createItineraryGenerationJob({
        generate: async () => ({ attempts: [], repairAttempts: 0, status: "success" }),
      }),
    );

    const queued = await enqueueItineraryGeneration(
      runtime,
      { createRun, finishFailure },
      { authUserId: "traveler-test", correlationId, expectedTripRevision: 3, tripId },
    );

    expect(createRun).toHaveBeenCalledWith({
      authUserId: "traveler-test",
      correlationId,
      expectedTripRevision: 3,
      maxRepairAttempts: 2,
      promptVersion: "itinerary-generation-v1",
      tripId,
    });
    expect(queued.job.envelope).toMatchObject({
      idempotencyKey: `itinerary:${tripId}:revision:4`,
      payload: { generationRunId, tripId, tripRevision: 4 },
      subjectId: tripId,
    });
    expect(finishFailure).not.toHaveBeenCalled();
  });

  test("marks the run failed when enqueueing cannot reserve a job", async () => {
    const store: ItineraryGenerationRunQueueStore = {
      createRun: async () => ({
        correlationId,
        maxRepairAttempts: 2,
        runId: generationRunId,
        status: "queued",
        tripId,
        tripRevision: 4,
      }),
      finishFailure: vi.fn<ItineraryGenerationRunQueueStore["finishFailure"]>(),
    };

    await expect(
      enqueueItineraryGeneration(new MemoryJobRuntime(), store, {
        authUserId: "traveler-test",
        correlationId,
        expectedTripRevision: 3,
        tripId,
      }),
    ).rejects.toThrow(`Job type ${ITINERARY_GENERATION_JOB_TYPE} is not registered`);
    expect(store.finishFailure).toHaveBeenCalledWith(generationRunId, {
      cancelled: false,
      code: "enqueue_failed",
      terminal: true,
    });
  });

  test("executes the versioned identifier-only payload and returns a redacted result", async () => {
    const generate = vi.fn<ItineraryGenerationJobService["generate"]>().mockResolvedValue({
      attempts: [{ outcome: "accepted" }],
      repairAttempts: 1,
      status: "success",
    });
    const runtime = new MemoryJobRuntime();
    runtime.register(createItineraryGenerationJob({ generate }));
    const record = await runtime.enqueue(enqueueInput());

    await runtime.runNext();

    expect(record.status).toBe("succeeded");
    expect(record.envelope.payload).toEqual({ generationRunId, tripId, tripRevision: 4 });
    expect(record.result).toEqual({
      attemptCount: 1,
      generationRunId,
      repairAttempts: 1,
      status: "succeeded",
      tripRevision: 4,
    });
    expect(generate).toHaveBeenCalledWith({
      jobAttempt: 1,
      maxJobAttempts: 3,
      requestId: correlationId,
      runId: generationRunId,
      signal: expect.any(AbortSignal),
      tripId,
      tripRevision: 4,
    });
  });

  test("retries a normalized retryable provider failure", async () => {
    const runtime = new MemoryJobRuntime({ jitter: () => 0.5 });
    runtime.register(
      createItineraryGenerationJob({
        generate: async () => ({
          attempts: [],
          error: { code: "rate_limited", retryable: true },
          repairAttempts: 0,
          status: "error",
        }),
      }),
    );
    const record = await runtime.enqueue(enqueueInput());

    await runtime.runNext();

    expect(record.status).toBe("retrying");
    expect(record.errorCode).toBe("rate_limited");
  });

  test("dead-letters a subject mismatch before invoking generation", async () => {
    const generate = vi.fn<ItineraryGenerationJobService["generate"]>();
    const runtime = new MemoryJobRuntime();
    runtime.register(createItineraryGenerationJob({ generate }));
    const record = await runtime.enqueue(enqueueInput("40000000-0000-4000-8000-000000000001"));

    await runtime.runNext();

    expect(record.status).toBe("dead_lettered");
    expect(record.errorCode).toBe("invalid_subject");
    expect(generate).not.toHaveBeenCalled();
  });

  test("rejects payloads containing full traveler or prompt content", () => {
    const job = createItineraryGenerationJob({
      generate: async () => ({ attempts: [], repairAttempts: 0, status: "success" }),
    });

    expect(() =>
      job.validatePayload({
        generationRunId,
        prompt: "sensitive trip prompt",
        tripId,
        tripRevision: 4,
      }),
    ).toThrow(/prompt|Unrecognized key/);
  });

  test("cancels an owned run and rejects mismatched references", async () => {
    const runtime = new MemoryJobRuntime();
    runtime.register(
      createItineraryGenerationJob({
        generate: async () => ({ attempts: [], repairAttempts: 0, status: "success" }),
      }),
    );
    const store = {
      createRun: async () => ({
        correlationId,
        maxRepairAttempts: 2,
        runId: generationRunId,
        status: "queued" as const,
        tripId,
        tripRevision: 4,
      }),
      finishFailure: vi.fn<ItineraryGenerationRunQueueStore["finishFailure"]>(),
      getLatestRun: async () => null,
    };
    const service = createItineraryGenerationRequestService(runtime, store);
    const queued = await service.requestGeneration(
      "traveler-test",
      tripId,
      { expectedTripRevision: 3 },
      { correlationId },
    );

    await expect(
      service.cancelGeneration("different-traveler", tripId, {
        generationRunId,
        jobId: queued.jobId,
      }),
    ).resolves.toBeNull();
    await expect(
      service.cancelGeneration("traveler-test", tripId, {
        generationRunId,
        jobId: queued.jobId,
      }),
    ).resolves.toEqual({ generationRunId, jobId: queued.jobId, status: "cancelled" });
    expect(store.finishFailure).toHaveBeenCalledWith(generationRunId, {
      cancelled: true,
      code: "cancelled",
      terminal: true,
    });
    await expect(runtime.get(queued.jobId)).resolves.toMatchObject({ status: "cancelled" });
  });
});
