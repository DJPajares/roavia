import { randomUUID } from "node:crypto";

import type { DisruptionAlternativeGenerator } from "@roavia/ai";
import {
  disruptionRecommendationSnapshotSchema,
  type DisruptionRecommendationSnapshot,
} from "@roavia/contracts";
import {
  createAssistantActionRepository,
  createDatabaseClient,
  createDisruptionRecommendationRepository,
  createTripRepository,
  TripConcurrencyError,
  type TripRepository,
} from "@roavia/db";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "../src/app.js";
import { createAssistantActionMutationService } from "../src/assistant.js";
import { createDisruptionRecommendationApiService } from "../src/disruptions.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

function headers(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-request-id": randomUUID(),
  };
}

describeDatabase("disruption recommendation API with PostgreSQL", () => {
  test("keeps, dismisses, deduplicates, replaces through confirmation, and fails safely", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const authUserId = randomUUID();
    const userId = randomUUID();
    const tripId = randomUUID();
    const cityId = randomUUID();
    const originalPlaceId = randomUUID();
    const alternativePlaceId = randomUUID();
    const dayId = randomUUID();
    const itemId = randomUUID();
    const secondItemId = randomUUID();
    const now = new Date();
    const sourceTime = now.toISOString();
    const actions = createAssistantActionRepository(client.db);
    const recommendations = createDisruptionRecommendationRepository(client.db);
    const trips = createTripRepository(client.db);

    const generate = vi.fn<DisruptionAlternativeGenerator["generate"]>(async ({ impact }) =>
      disruptionRecommendationSnapshotSchema.parse({
        alternative: {
          explanation:
            "The museum is a reviewed indoor option for the same itinerary slot while heavy rain affects the original stop.",
          itemType: impact.itemType,
          localDate: impact.localDate,
          name: "Indoor Museum",
          placeId: alternativePlaceId,
          source: {
            retrievedAt: sourceTime,
            sourceId: "alternative-source",
            title: "Official museum guide",
            updatedAt: sourceTime,
            url: "https://museum.example.test/visit",
          },
          timeLabel: impact.startTime ?? "Time flexible",
        },
        confidence: {
          explanation: "Fresh live evidence and approved place evidence support this comparison.",
          level: "high",
          score: 0.9,
        },
        impact: {
          impactId: impact.impactId,
          kind: impact.kind,
          reason: impact.summary,
          severity: impact.severity,
          source: {
            retrievedAt: impact.sourceRetrievedAt,
            sourceId: `live-impact-${impact.impactId}`,
            title: impact.sourceTitle,
            updatedAt: impact.sourceUpdatedAt,
            url: impact.sourceUrl,
          },
        },
        original: {
          itemId: impact.itineraryItemId,
          itemType: impact.itemType,
          localDate: impact.localDate,
          name: impact.originalName,
          placeId: impact.originalPlaceId,
          timeLabel: impact.startTime ?? "Time flexible",
        },
        tripId: impact.tripId,
      }),
    );
    const generator: DisruptionAlternativeGenerator = { generate };
    const mutations = createAssistantActionMutationService({ actions, trips });
    const service = createDisruptionRecommendationApiService({
      actions,
      generator,
      mutations,
      recommendations,
      trips,
    });
    const app = createApp({
      disruptionRecommendationService: service,
      tripRepository: trips,
      verifyAccessToken: async () => ({
        expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
        identity: { userId: authUserId },
      }),
    });

    async function insertImpact(providerEventId: string, targetItemId = itemId) {
      const impactId = randomUUID();
      await client.pool.query(
        `insert into live_condition_impacts
          (id, trip_id, itinerary_item_id, place_id, impact_key, kind, provider,
           provider_event_id, severity, confidence, impact_start, impact_end, summary,
           source_url, source_title, source_retrieved_at, source_updated_at, payload_hash,
           first_observed_at, last_changed_at)
         values ($1, $2, $3, $4, $5, 'weather', 'weather-fixture', $6, 'high', 0.9,
           '2026-08-10', '2026-08-10', 'Heavy rain affects the outdoor stop.',
           'https://weather.example.test/event', 'Official weather service', $7, $7,
           $8, $7, $7)`,
        [
          impactId,
          tripId,
          targetItemId,
          originalPlaceId,
          `weather-fixture:${providerEventId}:${targetItemId}`,
          providerEventId,
          sourceTime,
          "a".repeat(64),
        ],
      );
      return impactId;
    }

    async function refresh() {
      const response = await app.request(`/trips/${tripId}/disruption-recommendations/refresh`, {
        headers: headers("alice"),
        method: "POST",
      });
      expect(response.status).toBe(200);
      return (await response.json()) as {
        data: { recommendations: Array<{ id: string } & DisruptionRecommendationSnapshot> };
      };
    }

    try {
      await client.pool.query(
        "insert into users (id, auth_user_id, display_name) values ($1, $2, 'Disruption API')",
        [userId, authUserId],
      );
      await client.pool.query(
        `insert into places (id, parent_place_id, place_type, canonical_name, timezone, country_code)
         values
          ($1, null, 'city', 'Singapore', 'Asia/Singapore', 'SG'),
          ($2, $1, 'poi', 'Garden Walk', 'Asia/Singapore', 'SG'),
          ($3, $1, 'poi', 'Indoor Museum', 'Asia/Singapore', 'SG')`,
        [cityId, originalPlaceId, alternativePlaceId],
      );
      await client.pool.query(
        `insert into trips (id, owner_user_id, title, slug, start_date, end_date, status)
         values ($1, $2, 'Disruption trip', $3, '2026-08-10', '2026-08-12', 'active')`,
        [tripId, userId, `disruption-${randomUUID()}`],
      );
      await client.pool.query(
        `insert into trip_destinations (id, trip_id, place_id, order_index)
         values ($1, $2, $3, 0)`,
        [randomUUID(), tripId, cityId],
      );
      await client.pool.query(
        `insert into itinerary_days (id, trip_id, local_date, timezone, order_index)
         values ($1, $2, '2026-08-10', 'Asia/Singapore', 0)`,
        [dayId, tripId],
      );
      await client.pool.query(
        `insert into itinerary_items
          (id, itinerary_day_id, place_id, item_type, start_time, end_time, order_index)
         values
          ($1, $3, $4, 'activity', '09:00', '10:00', 0),
          ($2, $3, $4, 'activity', '11:00', '12:00', 1)`,
        [itemId, secondItemId, dayId, originalPlaceId],
      );

      await insertImpact("keep-event");
      const keptOffer = await refresh();
      expect(keptOffer.data.recommendations).toHaveLength(1);
      expect(keptOffer.data.recommendations[0]).toMatchObject({
        alternative: { name: "Indoor Museum", placeId: alternativePlaceId },
        confidence: { level: "high", score: 0.9 },
        impact: {
          reason: "Heavy rain affects the outdoor stop.",
          source: { title: "Official weather service", updatedAt: sourceTime },
        },
        original: { itemId, name: "Garden Walk", placeId: originalPlaceId },
      });
      const keptId = keptOffer.data.recommendations[0]!.id;
      const kept = await app.request(
        `/trips/${tripId}/disruption-recommendations/${keptId}/decision`,
        {
          body: JSON.stringify({ decision: "keep" }),
          headers: headers("alice"),
          method: "POST",
        },
      );
      expect(kept.status).toBe(200);
      await expect(kept.json()).resolves.toMatchObject({ data: { status: "kept" } });
      expect((await refresh()).data.recommendations).toHaveLength(0);

      await insertImpact("dismiss-event");
      const dismissedOffer = await refresh();
      const dismissedId = dismissedOffer.data.recommendations[0]!.id;
      const dismissed = await app.request(
        `/trips/${tripId}/disruption-recommendations/${dismissedId}/decision`,
        {
          body: JSON.stringify({ decision: "dismiss" }),
          headers: headers("alice"),
          method: "POST",
        },
      );
      expect(dismissed.status).toBe(200);
      expect((await refresh()).data.recommendations).toHaveLength(0);

      await insertImpact("apply-event");
      const appliedOffer = await refresh();
      const appliedId = appliedOffer.data.recommendations[0]!.id;
      const applied = await app.request(
        `/trips/${tripId}/disruption-recommendations/${appliedId}/apply`,
        { headers: headers("alice"), method: "POST" },
      );
      expect(applied.status).toBe(200);
      await expect(applied.json()).resolves.toMatchObject({
        data: { recommendationId: appliedId, status: "applied", tripRevision: 2 },
      });
      const replaced = await client.pool.query<{ place_id: string }>(
        "select place_id from itinerary_items where id = $1",
        [itemId],
      );
      expect(replaced.rows[0]?.place_id).toBe(alternativePlaceId);

      await insertImpact("failed-event", secondItemId);
      const failedOffer = await refresh();
      const failedRecommendation = failedOffer.data.recommendations.find(
        (recommendation) => recommendation.original.itemId === secondItemId,
      );
      expect(failedRecommendation).toBeDefined();
      const failingTrips = {
        ...trips,
        updateItem: vi
          .fn<TripRepository["updateItem"]>()
          .mockRejectedValue(new TripConcurrencyError()),
      } as TripRepository;
      const failingService = createDisruptionRecommendationApiService({
        actions,
        generator,
        mutations: createAssistantActionMutationService({ actions, trips: failingTrips }),
        recommendations,
        trips,
      });
      const failingApp = createApp({
        disruptionRecommendationService: failingService,
        verifyAccessToken: async () => ({
          expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
          identity: { userId: authUserId },
        }),
      });
      const failed = await failingApp.request(
        `/trips/${tripId}/disruption-recommendations/${failedRecommendation!.id}/apply`,
        { headers: headers("alice"), method: "POST" },
      );
      expect(failed.status).toBe(409);
      const unchanged = await client.pool.query<{ place_id: string }>(
        "select place_id from itinerary_items where id = $1",
        [secondItemId],
      );
      expect(unchanged.rows[0]?.place_id).toBe(originalPlaceId);
      const failedState = await client.pool.query<{ status: string }>(
        "select status from disruption_recommendations where id = $1",
        [failedRecommendation!.id],
      );
      expect(failedState.rows[0]?.status).toBe("failed");

      expect(generate).toHaveBeenCalledTimes(4);
    } finally {
      await client.pool.query("delete from users where id = $1", [userId]);
      await client.close();
    }
  });
});
