import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";

import { createDatabaseClient } from "../src/client.js";
import {
  getUpcomingLiveConditionTargets,
  listLiveConditionImpacts,
  listUpcomingLiveConditionTripIds,
  reconcileLiveConditionImpacts,
  type PersistedLiveConditionImpactInput,
} from "../src/live-condition-impact-repository.js";
import { itineraryDays, itineraryItems, places, trips, users } from "../src/schema.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const userId = "47000000-0000-4000-8000-000000000021";
const tripId = "47000000-0000-4000-8000-000000000022";
const placeId = "47000000-0000-4000-8000-000000000023";
const dayId = "47000000-0000-4000-8000-000000000024";
const itemId = "47000000-0000-4000-8000-000000000025";
const checkedAt = new Date("2026-08-02T08:00:00.000Z");

function impact(
  overrides: Partial<PersistedLiveConditionImpactInput> = {},
): PersistedLiveConditionImpactInput {
  return {
    confidence: 0.9,
    endDate: "2026-08-05",
    impactKey: `weather:weather-fixture:storm-august-5:${itemId}`,
    itineraryItemId: itemId,
    kind: "weather",
    placeId,
    provider: "weather-fixture",
    providerEventId: "storm-august-5",
    severity: "high",
    sourceRetrievedAt: "2026-08-02T07:55:00.000Z",
    sourceTitle: "Fixture weather source",
    sourceUpdatedAt: "2026-08-02T07:50:00.000Z",
    sourceUrl: "https://weather.example.test/forecast",
    startDate: "2026-08-05",
    summary: "A stronger storm forecast overlaps this activity.",
    tripId,
    ...overrides,
  };
}

describeDatabase("live-condition impact repository", () => {
  test("targets upcoming active items and persists advisory impacts idempotently", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    await client.db.delete(users).where(eq(users.id, userId));
    await client.db.delete(places).where(eq(places.id, placeId));
    await client.db.insert(users).values({
      authUserId: "auth-live-impact-fixture",
      displayName: "Live impact fixture",
      id: userId,
    });
    await client.db.insert(places).values({
      canonicalName: "Singapore live fixture",
      countryCode: "SG",
      id: placeId,
      latitude: 1.3521,
      longitude: 103.8198,
      placeType: "city",
      timezone: "Asia/Singapore",
    });
    await client.db.insert(trips).values({
      endDate: "2026-08-07",
      id: tripId,
      ownerUserId: userId,
      slug: "live-impact-fixture",
      startDate: "2026-08-05",
      status: "active",
      title: "Live impact fixture",
    });
    await client.db.insert(itineraryDays).values({
      id: dayId,
      localDate: "2026-08-05",
      orderIndex: 0,
      timezone: "Asia/Singapore",
      tripId,
    });
    await client.db.insert(itineraryItems).values({
      id: itemId,
      itineraryDayId: dayId,
      itemType: "activity",
      notes: "User-authored note must remain unchanged.",
      orderIndex: 0,
      placeId,
    });

    try {
      await expect(
        listUpcomingLiveConditionTripIds(client.db, {
          asOfDate: "2026-08-02",
          horizonEndDate: "2026-08-16",
        }),
      ).resolves.toEqual([tripId]);
      await client.db.update(trips).set({ status: "archived" }).where(eq(trips.id, tripId));
      await expect(
        listUpcomingLiveConditionTripIds(client.db, {
          asOfDate: "2026-08-02",
          horizonEndDate: "2026-08-16",
        }),
      ).resolves.toEqual([]);
      await client.db.update(trips).set({ status: "active" }).where(eq(trips.id, tripId));
      await expect(
        getUpcomingLiveConditionTargets(client.db, {
          asOfDate: "2026-08-02",
          horizonEndDate: "2026-08-16",
          tripId,
        }),
      ).resolves.toEqual([
        {
          coordinates: { latitude: 1.3521, longitude: 103.8198 },
          itineraryItemId: itemId,
          localDate: "2026-08-05",
          placeId,
          timezone: "Asia/Singapore",
          tripId,
        },
      ]);

      const firstImpact = impact();
      const observation = {
        impactKeys: [firstImpact.impactKey],
        kind: "weather" as const,
        placeId,
        provider: "weather-fixture",
      };
      const created = await reconcileLiveConditionImpacts(client.db, {
        checkedAt,
        impacts: [firstImpact],
        observations: [observation],
        tripId,
      });
      const duplicate = await reconcileLiveConditionImpacts(client.db, {
        checkedAt,
        impacts: [firstImpact],
        observations: [observation],
        tripId,
      });
      expect(created).toEqual({ created: 1, resolved: 0, unchanged: 0, updated: 0 });
      expect(duplicate).toEqual({ created: 0, resolved: 0, unchanged: 1, updated: 0 });

      const changed = await reconcileLiveConditionImpacts(client.db, {
        checkedAt: new Date("2026-08-02T09:00:00.000Z"),
        impacts: [impact({ severity: "critical", summary: "The forecast materially worsened." })],
        observations: [observation],
        tripId,
      });
      expect(changed.updated).toBe(1);

      const resolved = await reconcileLiveConditionImpacts(client.db, {
        checkedAt: new Date("2026-08-02T10:00:00.000Z"),
        impacts: [],
        observations: [{ ...observation, impactKeys: [] }],
        tripId,
      });
      const repeatedResolution = await reconcileLiveConditionImpacts(client.db, {
        checkedAt: new Date("2026-08-02T10:05:00.000Z"),
        impacts: [],
        observations: [{ ...observation, impactKeys: [] }],
        tripId,
      });
      expect(resolved.resolved).toBe(1);
      expect(repeatedResolution.resolved).toBe(0);

      const recovered = await reconcileLiveConditionImpacts(client.db, {
        checkedAt: new Date("2026-08-02T11:00:00.000Z"),
        impacts: [impact({ severity: "critical", summary: "The forecast materially worsened." })],
        observations: [observation],
        tripId,
      });
      expect(recovered.updated).toBe(1);

      const stored = await listLiveConditionImpacts(client.db, tripId);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        confidence: 0.9,
        itineraryItemId: itemId,
        severity: "critical",
        sourceUrl: firstImpact.sourceUrl,
        state: "active",
      });
      const [unchangedItem] = await client.db
        .select({ notes: itineraryItems.notes, orderIndex: itineraryItems.orderIndex })
        .from(itineraryItems)
        .where(eq(itineraryItems.id, itemId));
      expect(unchangedItem).toEqual({
        notes: "User-authored note must remain unchanged.",
        orderIndex: 0,
      });
    } finally {
      await client.db.delete(users).where(eq(users.id, userId));
      await client.db.delete(places).where(eq(places.id, placeId));
      await client.close();
    }
  });
});
