import { and, eq, inArray, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../src/client.js";
import {
  aiGenerationTelemetryInputSchema,
  createAiTelemetryRepository,
} from "../src/ai-telemetry-repository.js";
import { aiTelemetryEvents } from "../src/schema.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const GENERATION_ID = "11111111-1111-4111-8111-111111111111";
const EXPIRED_GENERATION_ID = "22222222-2222-4222-8222-222222222222";
const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";

describeDatabase("AI telemetry repository", () => {
  let client: DatabaseClient;

  beforeAll(() => {
    client = createDatabaseClient(testDatabaseUrl!);
  });

  afterAll(async () => {
    await client.db
      .delete(aiTelemetryEvents)
      .where(
        or(
          inArray(aiTelemetryEvents.generationId, [GENERATION_ID, EXPIRED_GENERATION_ID]),
          eq(aiTelemetryEvents.correlationId, CORRELATION_ID),
        ),
      );
    await client.close();
  });

  test("rejects content-bearing payloads before persistence", async () => {
    const sensitive = {
      durationMs: 25,
      generationId: GENERATION_ID,
      model: "provider/model-v1",
      operation: "assistant",
      outcome: "success",
      prompt: "Private itinerary dates and a home address",
      promptVersion: "assistant-v1",
      provider: "fixture",
      requestId: CORRELATION_ID,
      timestamp: "2026-07-29T00:00:00.000Z",
    };

    expect(aiGenerationTelemetryInputSchema.safeParse(sensitive).success).toBe(false);
    await expect(
      createAiTelemetryRepository(client.db).recordGeneration(sensitive as never),
    ).rejects.toThrow("Unrecognized key");
    const rows = await client.db
      .select()
      .from(aiTelemetryEvents)
      .where(eq(aiTelemetryEvents.generationId, GENERATION_ID));
    expect(rows).toEqual([]);
  });

  test("aggregates idempotent usage, cost, quality, repair, and action decisions", async () => {
    const repository = createAiTelemetryRepository(client.db);
    const timestamp = "2026-07-29T01:00:00.000Z";
    const generation = {
      cost: { amountMicros: 450, currency: "USD" as const },
      durationMs: 250,
      generationId: GENERATION_ID,
      model: "provider/model-v1",
      operation: "itinerary" as const,
      outcome: "success" as const,
      promptVersion: "itinerary-v1",
      provider: "fixture",
      requestId: CORRELATION_ID,
      safety: { blocked: false },
      timestamp,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    };
    await repository.recordGeneration(generation);
    await repository.recordGeneration(generation);
    await repository.recordQuality({
      correlationId: CORRELATION_ID,
      generationId: GENERATION_ID,
      issueCodes: ["duplicate_place", "impossible_timing"],
      model: generation.model,
      outcome: "rejected",
      promptVersion: generation.promptVersion,
      provider: generation.provider,
      repairCount: 1,
      timestamp,
    });
    await repository.recordQuality({
      correlationId: CORRELATION_ID,
      generationId: GENERATION_ID,
      issueCodes: ["duplicate_place"],
      model: generation.model,
      outcome: "rejected",
      promptVersion: generation.promptVersion,
      provider: generation.provider,
      repairCount: 1,
      timestamp,
    });
    await repository.recordAssistantAction({
      actionCount: 2,
      correlationId: CORRELATION_ID,
      outcome: "offered",
      timestamp,
    });
    await repository.recordAssistantAction({
      actionCount: 1,
      correlationId: CORRELATION_ID,
      outcome: "confirmed",
      timestamp,
    });
    await repository.recordAssistantAction({
      actionCount: 1,
      correlationId: CORRELATION_ID,
      outcome: "cancelled",
      timestamp,
    });

    const aggregates = await repository.aggregate({
      from: new Date("2026-07-29T00:00:00.000Z"),
      to: new Date("2026-07-30T00:00:00.000Z"),
    });
    expect(aggregates).toEqual([
      expect.objectContaining({
        acceptanceRate: 0.5,
        acceptedActionCount: 1,
        cancelledActionCount: 1,
        generationCount: 0,
        offeredActionCount: 2,
        operation: "assistant",
      }),
      expect.objectContaining({
        averageLatencyMs: 250,
        generationCount: 1,
        inputTokens: 100,
        operation: "itinerary",
        outputTokens: 50,
        p95LatencyMs: 250,
        repairCount: 1,
        totalEstimatedCostMicros: 450,
        totalTokens: 150,
        validationFailureCount: 2,
      }),
    ]);
    const stored = await client.db
      .select()
      .from(aiTelemetryEvents)
      .where(
        and(
          eq(aiTelemetryEvents.generationId, GENERATION_ID),
          eq(aiTelemetryEvents.eventType, "generation"),
        ),
      );
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]!)).not.toContain("prompt");
    expect(JSON.stringify(stored)).not.toContain("Private itinerary");
  });

  test("prunes raw telemetry at the 90-day retention boundary", async () => {
    const repository = createAiTelemetryRepository(client.db);
    await repository.recordGeneration({
      durationMs: 10,
      generationId: EXPIRED_GENERATION_ID,
      model: "provider/model-v1",
      operation: "trip_intent",
      outcome: "error",
      promptVersion: "trip-intent-v1",
      provider: "fixture",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(await repository.pruneExpired(new Date("2026-04-02T00:00:00.000Z"))).toBeGreaterThan(0);
    const rows = await client.db
      .select()
      .from(aiTelemetryEvents)
      .where(eq(aiTelemetryEvents.generationId, EXPIRED_GENERATION_ID));
    expect(rows).toEqual([]);
  });
});
