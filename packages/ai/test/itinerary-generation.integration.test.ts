import { randomUUID } from "node:crypto";

import { createDatabaseClient, createTripRepository } from "@roavia/db";
import { describe, expect, test } from "vitest";

import {
  AiGateway,
  GroundingRetriever,
  ItineraryGenerationEngine,
  ItineraryGenerationService,
  type ItineraryOutputV1,
} from "../src/index.js";
import {
  PostgresItineraryGenerationStore,
  ItineraryGenerationRunStateError,
} from "../src/server/index.js";
import {
  FixtureAiProvider,
  FixtureGroundingDataSource,
  groundingCandidateFixture,
  officialGroundingSourceFixture,
} from "../src/testing.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

function generatedOutput(placeId: string, duplicate = false): ItineraryOutputV1 {
  const source = {
    official: officialGroundingSourceFixture.official,
    retrievedAt: officialGroundingSourceFixture.retrievedAt,
    sourceId: officialGroundingSourceFixture.sourceId,
    title: officialGroundingSourceFixture.title,
    url: officialGroundingSourceFixture.url,
    validUntil: officialGroundingSourceFixture.validUntil,
  };
  const firstItem: ItineraryOutputV1["days"][number]["items"][number] = {
    booking: { required: false, status: "not_needed", url: null },
    candidateId: "garden-morning",
    confidence: {
      explanation: "The place and availability are supported by fixture evidence.",
      level: "high",
    },
    durationMinutes: 120,
    endTime: "11:00",
    estimatedCost: null,
    itemType: "activity",
    notes: "Bring water.",
    place: { address: "18 Marina Gardens Drive", name: "Gardens by the Bay", placeId },
    sourceIds: [source.sourceId],
    startTime: "09:00",
    title: "Explore the gardens",
  };
  return {
    assumptions: [
      {
        code: "balanced-pace",
        needsConfirmation: true,
        summary: "The draft assumes a balanced walking pace.",
      },
    ],
    days: [
      {
        candidateId: "day-one",
        items: duplicate
          ? [
              firstItem,
              {
                ...firstItem,
                candidateId: "garden-repeat",
                endTime: "12:00",
                startTime: "10:00",
              },
            ]
          : [firstItem],
        localDate: "2026-10-10",
        notes: null,
        timezone: "Asia/Singapore",
        title: "Garden day",
      },
    ],
    schemaVersion: "roavia.itinerary.v1",
    sources: [source],
    title: "Singapore gardens",
    warnings: [],
  };
}

describeDatabase("PostgreSQL itinerary generation persistence", () => {
  test("persists only validated drafts, exposes metadata, and rejects stale replacement", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const authUserId = randomUUID();
    const userId = randomUUID();
    const placeId = randomUUID();
    const tripId = randomUUID();
    const store = new PostgresItineraryGenerationStore(client.db);
    const tripRepository = createTripRepository(client.db);
    const grounding = new GroundingRetriever([
      new FixtureGroundingDataSource({
        candidates: [
          groundingCandidateFixture({
            candidateId: "gardens-grounding",
            destinationIds: [placeId],
            facts: [
              { key: "accessibility", value: "accessible" },
              { key: "availability", value: "open" },
            ],
            kind: "place",
            title: "Gardens by the Bay",
          }),
        ],
      }),
    ]);

    await client.pool.query(
      `insert into users (id, auth_user_id, display_name, locale, timezone)
       values ($1, $2, 'Generation Test', 'en', 'Asia/Singapore')`,
      [userId, authUserId],
    );
    await client.pool.query(
      `insert into travel_profiles (
         user_id, default_budget_style, default_pace, interests_json,
         dietary_needs_json, accessibility_needs_json, travel_preferences_json
       ) values ($1, 'midrange', 'balanced', '["gardens"]', '[]',
         '["Step-free access"]', '{"mustAvoid":[],"mustDo":["Gardens by the Bay"]}')`,
      [userId],
    );
    await client.pool.query(
      `insert into places (id, place_type, canonical_name, timezone, country_code)
       values ($1, 'city', 'Singapore', 'Asia/Singapore', 'SG')`,
      [placeId],
    );
    await client.pool.query(
      `insert into trips (
         id, owner_user_id, title, slug, start_date, end_date,
         traveler_summary_json, budget_json
       ) values ($1, $2, 'Singapore gardens', $3, '2026-10-10', '2026-10-12',
         '{"adults":2,"children":0,"infants":0}',
         '{"amountMinor":null,"currency":"USD","style":"midrange"}')`,
      [tripId, userId, `generation-${tripId}`],
    );
    await client.pool.query(
      `insert into trip_destinations (trip_id, place_id, order_index)
       values ($1, $2, 0)`,
      [tripId, placeId],
    );

    try {
      const created = await store.createRun({
        authUserId,
        correlationId: randomUUID(),
        expectedTripRevision: 1,
        maxRepairAttempts: 2,
        promptVersion: "itinerary-generation-v1",
        tripId,
      });
      const provider = new FixtureAiProvider({
        steps: [{ result: { value: generatedOutput(placeId) } }],
      });
      const service = new ItineraryGenerationService({
        engine: new ItineraryGenerationEngine(new AiGateway(provider)),
        retriever: grounding,
        store,
      });

      await expect(
        service.generate({
          requestId: created.correlationId,
          runId: created.runId,
          tripId,
          tripRevision: created.tripRevision + 1,
        }),
      ).rejects.toBeInstanceOf(ItineraryGenerationRunStateError);
      expect(provider.calls).toHaveLength(0);

      const result = await service.generate({
        jobAttempt: 1,
        maxJobAttempts: 3,
        requestId: created.correlationId,
        runId: created.runId,
        tripId,
        tripRevision: created.tripRevision,
      });

      expect(result.status).toBe("success");
      const persisted = await tripRepository.getTrip(authUserId, tripId);
      expect(persisted).toMatchObject({
        days: [
          {
            items: [
              {
                confidence: 0.9,
                notes: "Explore the gardens\nBring water.",
                placeId,
                sourceSnapshot: {
                  confidence: { level: "high" },
                  sources: [{ sourceId: officialGroundingSourceFixture.sourceId }],
                },
              },
            ],
          },
        ],
        generation: {
          assumptions: [{ code: "balanced-pace", needsConfirmation: true }],
          groundingStatus: "partial",
          overallConfidence: 0.9,
          repairAttempts: 0,
          sources: [{ sourceId: officialGroundingSourceFixture.sourceId }],
          status: "succeeded",
        },
        generationState: "ready",
        revision: 3,
      });
      const completedRun = await store.getLatestRun(authUserId, tripId);
      expect(completedRun).toMatchObject({
        attempts: [{ attemptNumber: 1, kind: "initial", outcome: "accepted" }],
        status: "succeeded",
      });
      await expect(store.getLatestRun(randomUUID(), tripId)).resolves.toBeNull();

      const staleRun = await store.createRun({
        authUserId,
        correlationId: randomUUID(),
        expectedTripRevision: 3,
        maxRepairAttempts: 2,
        promptVersion: "itinerary-generation-v1",
        tripId,
      });
      await tripRepository.updateTrip(authUserId, tripId, {
        expectedRevision: staleRun.tripRevision,
        title: "Edited while generation was queued",
      });
      await expect(
        service.generate({
          requestId: staleRun.correlationId,
          runId: staleRun.runId,
          tripId,
          tripRevision: staleRun.tripRevision,
        }),
      ).rejects.toBeInstanceOf(ItineraryGenerationRunStateError);
      expect(provider.calls).toHaveLength(1);
      expect(await store.getLatestRun(authUserId, tripId)).toMatchObject({
        failureCode: "stale_trip_revision",
        status: "failed",
      });
      expect((await tripRepository.getTrip(authUserId, tripId)).days).toHaveLength(1);

      const current = await tripRepository.getTrip(authUserId, tripId);
      const rejectedRun = await store.createRun({
        authUserId,
        correlationId: randomUUID(),
        expectedTripRevision: current.revision,
        maxRepairAttempts: 0,
        promptVersion: "itinerary-generation-v1",
        tripId,
      });
      const rejectedService = new ItineraryGenerationService({
        engine: new ItineraryGenerationEngine(
          new AiGateway(
            new FixtureAiProvider({
              steps: [{ result: { value: generatedOutput(placeId, true) } }],
            }),
          ),
          { maxRepairAttempts: 0 },
        ),
        retriever: grounding,
        store,
      });
      const rejected = await rejectedService.generate({
        requestId: rejectedRun.correlationId,
        runId: rejectedRun.runId,
        tripId,
        tripRevision: rejectedRun.tripRevision,
      });
      expect(rejected).toMatchObject({ error: { code: "validation_failed" }, status: "error" });
      const afterRejection = await tripRepository.getTrip(authUserId, tripId);
      expect(afterRejection.days).toHaveLength(1);
      expect(afterRejection.generationState).toBe("failed");
      expect(await store.getLatestRun(authUserId, tripId)).toMatchObject({
        attempts: [{ outcome: "rejected" }],
        status: "failed",
      });
    } finally {
      await client.pool.query("delete from users where id = $1", [userId]);
      await client.pool.query("delete from places where id = $1", [placeId]);
      await client.close();
    }
  });
});
