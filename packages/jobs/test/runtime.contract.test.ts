import { z } from "zod";
import { describe, expect, test } from "vitest";

import {
  MemoryJobRuntime,
  MemoryJobStore,
  MemoryReferenceEffectStore,
  createReferenceJob,
  defaultJobPolicy,
  defineJob,
} from "../src/index.js";

const correlationId = "46edbf9d-5c17-4f45-9287-69a39450a9dc";

function input(idempotencyKey: string) {
  return {
    correlationId,
    idempotencyKey,
    payload: { effectKey: "fixture", revision: 1 },
    requestedBy: { id: "system-test", kind: "system" as const },
    subjectId: "fixture-subject",
    type: "system.reference-effect.v1",
  };
}

describe("job runtime contract", () => {
  test("completes a reference job and deduplicates duplicate delivery", async () => {
    const effects = new MemoryReferenceEffectStore();
    const runtime = new MemoryJobRuntime();
    runtime.register(createReferenceJob(effects));

    const first = await runtime.enqueue(input("reference:success:1"));
    const duplicate = await runtime.enqueue(input("reference:success:1"));
    expect(duplicate.envelope.jobId).toBe(first.envelope.jobId);
    await expect(
      runtime.enqueue({ ...input("reference:success:1"), subjectId: "different-subject" }),
    ).rejects.toThrow("reserved for a different job operation");

    await runtime.runUntilIdle();
    expect(first.status).toBe("succeeded");
    expect(first.result).toEqual({ applied: true });
    expect(effects.applied.size).toBe(1);
  });

  test("retries transient failures with bounded exponential backoff", async () => {
    let now = new Date("2026-07-28T00:00:00.000Z");
    const runtime = new MemoryJobRuntime({ clock: () => new Date(now), jitter: () => 0.5 });
    runtime.register(
      createReferenceJob(new MemoryReferenceEffectStore(), { transientFailures: 1 }),
    );
    const record = await runtime.enqueue(input("reference:retry:1"));

    await runtime.runNext();
    expect(record.status).toBe("retrying");
    expect(await runtime.listJobs({ statuses: ["retrying"] })).toEqual([record]);
    expect(record.availableAt.toISOString()).toBe("2026-07-28T00:00:00.100Z");

    now = new Date("2026-07-28T00:00:00.100Z");
    await runtime.runNext();
    expect(record.status).toBe("succeeded");
    expect(record.attempt).toBe(2);
  });

  test("dead-letters permanent failures and supports audited recovery actions", async () => {
    const runtime = new MemoryJobRuntime();
    runtime.register(
      createReferenceJob(new MemoryReferenceEffectStore(), { failPermanently: true }),
    );
    const record = await runtime.enqueue(input("reference:permanent:1"));
    await runtime.runNext();

    expect(record.status).toBe("dead_lettered");
    expect((await runtime.listDeadLetters())[0]?.errorCode).toBe("reference_permanent_failure");
    expect(await runtime.listJobs({ statuses: ["dead_lettered"], limit: 1 })).toEqual([record]);

    const replacement = await runtime.redrive(
      record.envelope.jobId,
      "operator-1",
      "Input was corrected.",
    );
    expect(replacement.status).toBe("queued");
    expect(replacement.originJobId).toBe(record.envelope.jobId);

    const action = await runtime.discard(
      record.envelope.jobId,
      "operator-1",
      "Superseded by redrive.",
    );
    expect(action.action).toBe("discard");
    expect(record.status).toBe("discarded");
    expect(runtime.store.operatorActions).toHaveLength(2);
  });

  test("cancels queued jobs at a safe checkpoint", async () => {
    const runtime = new MemoryJobRuntime();
    runtime.register(createReferenceJob(new MemoryReferenceEffectStore()));
    const record = await runtime.enqueue(input("reference:cancel:1"));

    await runtime.cancel(record.envelope.jobId);
    expect(record.status).toBe("cancelled");
    expect(await runtime.runNext()).toBeUndefined();
  });

  test("cancels and scrubs every job requested by a deleted account", async () => {
    const runtime = new MemoryJobRuntime();
    runtime.register(createReferenceJob(new MemoryReferenceEffectStore()));
    const requestedByUser = await runtime.enqueue({
      ...input("reference:deleted-user:1"),
      requestedBy: { id: "deleted-user", kind: "user" },
    });
    const requestedBySystem = await runtime.enqueue(input("reference:system-kept:1"));

    await expect(runtime.cancelByRequester("deleted-user", "deletion-receipt")).resolves.toBe(1);
    expect(requestedByUser).toMatchObject({
      envelope: {
        payload: {},
        requestedBy: { id: "deletion-receipt", kind: "system" },
        subjectId: "deletion-receipt",
      },
      status: "cancelled",
    });
    expect(requestedBySystem.envelope.payload).toEqual({ effectKey: "fixture", revision: 1 });
  });

  test("recovers an interrupted active job after a worker restart", async () => {
    const store = new MemoryJobStore();
    const effects = new MemoryReferenceEffectStore();
    const firstRuntime = new MemoryJobRuntime({ store });
    firstRuntime.register(createReferenceJob(effects));
    const record = await firstRuntime.enqueue(input("reference:restart:1"));
    record.status = "running";
    record.attempt = 1;

    const restartedRuntime = new MemoryJobRuntime({ store });
    restartedRuntime.register(createReferenceJob(effects));
    await restartedRuntime.recoverInterrupted();
    await restartedRuntime.runNext();

    expect(record.status).toBe("succeeded");
    expect(record.attempt).toBe(2);
    expect(effects.applied.size).toBe(1);
  });

  test("turns an execution timeout into a bounded transient failure", async () => {
    const runtime = new MemoryJobRuntime();
    runtime.register(
      defineJob({
        handler: () => new Promise(() => undefined),
        payloadSchema: z.object({ effectKey: z.string(), revision: z.number() }),
        payloadVersion: 1,
        policy: { ...defaultJobPolicy, maxAttempts: 1, timeoutMs: 5 },
        type: "system.reference-effect.v1",
      }),
    );
    const record = await runtime.enqueue(input("reference:timeout:1"));

    await runtime.runNext();
    expect(record.status).toBe("dead_lettered");
    expect(record.errorCode).toBe("timeout");
  });
});
