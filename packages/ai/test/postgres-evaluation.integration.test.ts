import {
  aiEvaluationCaseResults,
  aiEvaluationRuns,
  createDatabaseClient,
  type DatabaseClient,
} from "@roavia/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { runAiEvaluationSuite } from "../src/evaluation.js";
import {
  AiEvaluationHistoryConflictError,
  PostgresAiEvaluationHistoryStore,
} from "../src/server/postgres-evaluation.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const BASELINE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CURRENT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

async function report(runId: string, model: string, promptVersion: string) {
  let tick = 0;
  const now = Date.now();
  return runAiEvaluationSuite({
    cases: [
      {
        caseId: "all-required-dimensions",
        caseVersion: "v1",
        dimensions: [
          "feasibility",
          "relevance",
          "grounding",
          "budget",
          "family_accessibility",
          "seasonality",
          "unsupported_claims",
          "repair_quality",
        ],
        evaluate: () => ({
          durationMs: 100,
          estimatedCostMicros: 800,
          failureCodes: [],
          scores: {
            budget: 1,
            family_accessibility: 1,
            feasibility: 1,
            grounding: 1,
            relevance: 1,
            repair_quality: 1,
            seasonality: 1,
            unsupported_claims: 1,
          },
        }),
      },
    ],
    clock: () => new Date(now + tick++),
    createRunId: () => runId,
    model,
    promptVersion,
    provider: "fixture",
    suiteId: "roavia-ai-quality",
    suiteVersion: "v1",
  });
}

describeDatabase("PostgreSQL AI evaluation history", () => {
  let client: DatabaseClient;

  beforeAll(() => {
    client = createDatabaseClient(testDatabaseUrl!);
  });

  afterAll(async () => {
    await client.db
      .delete(aiEvaluationCaseResults)
      .where(inArray(aiEvaluationCaseResults.evaluationRunId, [BASELINE_ID, CURRENT_ID]));
    await client.db
      .delete(aiEvaluationRuns)
      .where(inArray(aiEvaluationRuns.id, [BASELINE_ID, CURRENT_ID]));
    await client.close();
  });

  test("appends immutable reports and compares model and prompt versions", async () => {
    const store = new PostgresAiEvaluationHistoryStore(client.db);
    const baseline = await report(BASELINE_ID, "fixture/model-v1", "fixture-prompt-v1");
    const current = await report(CURRENT_ID, "fixture/model-v2", "fixture-prompt-v2");

    await store.save(baseline);
    await store.save(current);
    await expect(store.save(current)).rejects.toBeInstanceOf(AiEvaluationHistoryConflictError);

    await expect(store.get(BASELINE_ID)).resolves.toEqual(baseline);
    await expect(store.compare(BASELINE_ID, CURRENT_ID)).resolves.toMatchObject({
      baseline: { model: "fixture/model-v1", promptVersion: "fixture-prompt-v1" },
      current: { model: "fixture/model-v2", promptVersion: "fixture-prompt-v2" },
      overallScoreDelta: 0,
    });
    const rows = await client.db.select().from(aiEvaluationRuns);
    expect(rows.filter(({ id }) => [BASELINE_ID, CURRENT_ID].includes(id))).toHaveLength(2);
  });
});
