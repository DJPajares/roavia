import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { MemoryReferenceEffectStore, createReferenceJob } from "../src/index.js";
import { PgBossJobRuntime } from "../src/pg-boss.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

const correlationId = "8a1a3f8a-8061-4dad-a3ca-76d13052020f";

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}

describeDatabase("pg-boss job runtime", () => {
  let runtime: PgBossJobRuntime;

  beforeAll(async () => {
    runtime = new PgBossJobRuntime({
      applicationName: "roavia-jobs-integration-test",
      connectionString: testDatabaseUrl!,
      releaseSha: "integration-test",
    });
    runtime.register(createReferenceJob(new MemoryReferenceEffectStore()));
    await runtime.start();
  });

  afterAll(async () => {
    await runtime.shutdown();
  });

  test("executes through PostgreSQL and deduplicates enqueue requests", async () => {
    const idempotencyKey = `reference:pg-boss:${crypto.randomUUID()}`;
    const input = {
      correlationId,
      idempotencyKey,
      payload: { effectKey: idempotencyKey, revision: 1 },
      requestedBy: { id: "integration-test", kind: "system" as const },
      subjectId: "fixture-subject",
      type: "system.reference-effect.v1",
    };

    const first = await runtime.enqueue(input);
    const duplicate = await runtime.enqueue(input);
    expect(duplicate.envelope.jobId).toBe(first.envelope.jobId);

    await waitFor(async () => (await runtime.get(first.envelope.jobId))?.status === "succeeded");
    const completed = await runtime.get(first.envelope.jobId);
    expect(completed).toMatchObject({
      attempt: 1,
      releaseSha: "integration-test",
      result: { applied: true },
      status: "succeeded",
    });
  }, 15_000);

  test("lists and cancels deferred work without executing it", async () => {
    const idempotencyKey = `reference:cancel:${crypto.randomUUID()}`;
    const queued = await runtime.enqueue({
      correlationId,
      idempotencyKey,
      notBefore: new Date(Date.now() + 60_000),
      payload: { effectKey: idempotencyKey, revision: 1 },
      requestedBy: { id: "integration-test", kind: "system" },
      subjectId: "cancel-fixture",
      type: "system.reference-effect.v1",
    });

    expect(await runtime.listJobs({ statuses: ["queued"] })).toContainEqual(queued);
    const cancelled = await runtime.cancel(queued.envelope.jobId);
    expect(cancelled.status).toBe("cancelled");
    expect(await runtime.listJobs({ statuses: ["queued"] })).not.toContainEqual(cancelled);
  });
});
