import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";

import { createDatabaseClient } from "../src/client.js";
import {
  getSeasonalInsight,
  listSeasonalInsights,
  upsertSeasonalInsight,
} from "../src/seasonal-insight-repository.js";
import { places, seasonalInsights } from "../src/schema.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const placeId = "45000000-0000-4000-8000-000000000001";

function insight(input: { crowd?: boolean; refreshedAt: string; weather: number }) {
  const weatherEvidence = {
    confidence: 0.85,
    evidence: [],
    favorability: input.weather,
    refreshedAt: input.refreshedAt,
    sourceIds: ["source:tokyo-climate"],
    state: "available",
  };
  const crowdEvidence = {
    confidence: input.crowd ? 0.8 : null,
    evidence: [],
    favorability: input.crowd ? 0.3 : null,
    refreshedAt: input.crowd ? input.refreshedAt : null,
    sourceIds: input.crowd ? ["source:tokyo-crowds"] : [],
    state: input.crowd ? "available" : "missing",
  };
  return {
    confidence: 0.8,
    explanation: { caveats: [], summary: "Fixture insight.", tradeoffs: [] },
    period: { kind: "month" as const, month: 4, year: 2027 },
    periodKey: "month:2027-04",
    placeId,
    priorities: { budget: 1, closures: 1, crowds: 1, festivals: 1, weather: 1 },
    rating: "favorable",
    refreshedAt: input.refreshedAt,
    score: input.weather,
    signals: { crowds: crowdEvidence, weather: weatherEvidence },
    sourceIds: input.crowd
      ? ["source:tokyo-climate", "source:tokyo-crowds"]
      : ["source:tokyo-climate"],
  };
}

describeDatabase("seasonal insight repository", () => {
  test("refreshes idempotently and preserves reviewed overrides", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    await client.db.delete(seasonalInsights).where(eq(seasonalInsights.placeId, placeId));
    await client.db.delete(places).where(eq(places.id, placeId));
    await client.db.insert(places).values({
      canonicalName: "Tokyo seasonal fixture",
      countryCode: "JP",
      id: placeId,
      placeType: "city",
      timezone: "Asia/Tokyo",
    });

    try {
      const firstInsight = insight({
        crowd: false,
        refreshedAt: "2026-08-01T01:00:00.000Z",
        weather: 0.8,
      });
      const created = await upsertSeasonalInsight(client.db, firstInsight);
      const duplicate = await upsertSeasonalInsight(client.db, firstInsight);

      expect(created.outcome).toBe("created");
      expect(duplicate).toMatchObject({ outcome: "unchanged", recordId: created.recordId });

      await client.db
        .update(seasonalInsights)
        .set({
          reviewedAt: new Date("2026-08-01T02:00:00.000Z"),
          reviewedBy: "editor@example.test",
          reviewedOverride: { explanation: "Reviewed local nuance." },
        })
        .where(eq(seasonalInsights.id, created.recordId));

      const refreshedInsight = insight({
        crowd: true,
        refreshedAt: "2026-08-02T01:00:00.000Z",
        weather: 0.65,
      });
      const refreshed = await upsertSeasonalInsight(client.db, refreshedInsight);
      const stored = await getSeasonalInsight(client.db, placeId, refreshedInsight.periodKey);
      const listed = await listSeasonalInsights(client.db, placeId);

      expect(refreshed).toMatchObject({
        outcome: "updated",
        preservedReviewedOverride: true,
        recordId: created.recordId,
      });
      expect(stored).toMatchObject({
        computedInsight: { signals: { crowds: { state: "available" } } },
        reviewedBy: "editor@example.test",
        reviewedOverride: { explanation: "Reviewed local nuance." },
        sourceIds: ["source:tokyo-climate", "source:tokyo-crowds"],
      });
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: created.recordId, sourceIds: stored?.sourceIds });
    } finally {
      await client.db.delete(seasonalInsights).where(eq(seasonalInsights.placeId, placeId));
      await client.db.delete(places).where(eq(places.id, placeId));
      await client.close();
    }
  });
});
