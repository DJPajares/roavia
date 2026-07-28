import { describe, expect, test } from "vitest";

import { MemoryJobRuntime, createDestinationCatalogIngestionJob } from "../src/index.js";

describe("destination catalog ingestion job", () => {
  test("runs the versioned refresh contract once for duplicate delivery", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const runtime = new MemoryJobRuntime();
    runtime.register(
      createDestinationCatalogIngestionJob({
        ingest: async (payload) => {
          calls.push(payload);
          return { mode: payload.mode, recordsReceived: 8 };
        },
      }),
    );

    const input = {
      correlationId: "63fe370c-8ef7-4290-a3f8-ab4f99d38489",
      idempotencyKey: "destination:mvp-launch-v1:refresh:1",
      payload: { catalogKey: "mvp-launch-v1", mode: "refresh" },
      requestedBy: { id: "system-test", kind: "system" as const },
      subjectId: "mvp-launch-v1",
      type: "destination.catalog-ingest.v1",
    };

    const first = await runtime.enqueue(input);
    const duplicate = await runtime.enqueue(input);
    expect(duplicate.envelope.jobId).toBe(first.envelope.jobId);

    await runtime.runUntilIdle();
    expect(first.status).toBe("succeeded");
    expect(first.result).toEqual({ mode: "refresh", recordsReceived: 8 });
    expect(calls).toEqual([{ catalogKey: "mvp-launch-v1", mode: "refresh" }]);
  });

  test("rejects unknown catalog payloads before execution", async () => {
    const job = createDestinationCatalogIngestionJob({
      ingest: async () => ({ recordsReceived: 0 }),
    });

    expect(() => job.validatePayload({ catalogKey: "unapproved", mode: "refresh" })).toThrow(
      /Invalid input/,
    );
  });
});
