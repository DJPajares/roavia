import type { TripDetail } from "@roavia/contracts";
import type { DisruptionImpactCandidate } from "@roavia/db";
import { describe, expect, test } from "vitest";

import {
  DisruptionAlternativeGenerationError,
  GroundedDisruptionAlternativeService,
} from "../src/disruption-alternatives.js";
import { AiGateway } from "../src/gateway.js";
import { GroundingRetriever } from "../src/grounding.js";
import { ASSISTANT_OUTPUT_SCHEMA_VERSION, type AssistantOutputV1 } from "../src/schemas.js";
import {
  FixtureAiProvider,
  FixtureGroundingDataSource,
  groundingCandidateFixture,
} from "../src/testing.js";

const tripId = "10000000-0000-4000-8000-000000000001";
const destinationId = "20000000-0000-4000-8000-000000000002";
const originalPlaceId = "30000000-0000-4000-8000-000000000003";
const alternativePlaceId = "40000000-0000-4000-8000-000000000004";
const itemId = "50000000-0000-4000-8000-000000000005";
const impactId = "60000000-0000-4000-8000-000000000006";
const liveSourceId = `live-impact-${impactId}`;

const trip = {
  budget: { amountMinor: null, currency: "USD", style: "midrange" },
  days: [
    {
      id: "70000000-0000-4000-8000-000000000007",
      items: [{ id: itemId, placeId: originalPlaceId }],
      localDate: "2026-08-10",
    },
  ],
  destinations: [{ placeId: destinationId }],
  endDate: "2026-08-12",
  id: tripId,
  planningPreferences: null,
  startDate: "2026-08-10",
  title: "Singapore in the rain",
} as TripDetail;

const impact: DisruptionImpactCandidate = {
  confidence: 0.9,
  impactId,
  impactKey: "weather:event:item",
  itemType: "activity",
  itineraryItemId: itemId,
  kind: "weather",
  localDate: "2026-08-10",
  originalName: "Garden walk",
  originalPlaceId,
  provider: "weather-fixture",
  severity: "high",
  sourceRetrievedAt: "2026-08-02T01:00:00.000Z",
  sourceTitle: "Official weather service",
  sourceUpdatedAt: "2026-08-02T00:45:00.000Z",
  sourceUrl: "https://weather.example.test/event",
  startTime: "09:00:00",
  summary: "Heavy rain is expected during the outdoor visit.",
  tripId,
};

function candidates(freshness: "fresh" | "stale" = "fresh") {
  const common = {
    confidence: {
      explanation: "Approved fixture evidence.",
      level: "high" as const,
      score: 0.9,
    },
    destinationIds: [alternativePlaceId],
    freshness: {
      expiresAt: "2027-08-02T00:00:00.000Z",
      observedAt: "2026-08-02T00:00:00.000Z",
      staleAt: "2026-12-02T00:00:00.000Z",
      state: freshness,
    },
    sources: [
      {
        attributionText: null,
        kind: "official_operator" as const,
        license: null,
        licenseUrl: null,
        official: true,
        provider: "museum",
        publishedAt: null,
        retrievedAt: "2026-08-02T00:00:00.000Z",
        sourceId: "source-indoor-museum",
        title: "Indoor museum guide",
        trustTier: "tier_1" as const,
        url: "https://museum.example.test/visit",
        validFrom: null,
        validUntil: null,
      },
    ],
  };
  return [
    groundingCandidateFixture({
      ...common,
      candidateId: "museum-place",
      kind: "place",
      title: "Indoor Museum — overview",
    }),
    groundingCandidateFixture({
      ...common,
      candidateId: "museum-practical",
      kind: "practical",
      title: "Indoor Museum — practical",
    }),
  ];
}

function output(placeId = alternativePlaceId): AssistantOutputV1 {
  return {
    answer:
      "The indoor museum keeps the morning slot while avoiding the forecast outdoor exposure.",
    claims: [
      {
        claimId: "disruption-claim",
        confidence: { explanation: "Both sources are current.", level: "high" },
        sourceIds: [liveSourceId, "source-indoor-museum"],
        text: "An indoor replacement avoids the forecast outdoor exposure.",
      },
    ],
    safety: {
      classification: "general",
      explanation: "This is a source-backed itinerary comparison.",
      officialSourceRequired: false,
    },
    schemaVersion: ASSISTANT_OUTPUT_SCHEMA_VERSION,
    sources: [
      {
        official: true,
        retrievedAt: impact.sourceRetrievedAt,
        sourceId: liveSourceId,
        title: impact.sourceTitle,
        url: impact.sourceUrl,
        validUntil: null,
      },
      {
        official: true,
        retrievedAt: "2026-08-02T00:00:00.000Z",
        sourceId: "source-indoor-museum",
        title: "Indoor museum guide",
        url: "https://museum.example.test/visit",
        validUntil: null,
      },
    ],
    suggestedActions: [
      {
        actionId: "replace-disrupted-item",
        kind: "replace_item",
        parameters: { itemId, placeId },
        requiresConfirmation: true,
        sourceIds: [liveSourceId, "source-indoor-museum"],
        summary: "Replace the garden walk with the indoor museum.",
      },
    ],
    uncertainty: { explanation: "Conditions may continue to change.", level: "medium" },
  };
}

function service(provider: FixtureAiProvider, freshness: "fresh" | "stale" = "fresh") {
  return new GroundedDisruptionAlternativeService(
    new AiGateway(provider),
    new GroundingRetriever([
      new FixtureGroundingDataSource({
        candidates: candidates(freshness),
        supportedKinds: ["place", "practical"],
      }),
    ]),
  );
}

describe("grounded disruption alternatives", () => {
  test("returns a source-aware replacement comparison without mutating the trip", async () => {
    const provider = new FixtureAiProvider({ steps: [{ result: { value: output() } }] });
    const result = await service(provider).generate({ impact, trip });

    expect(result).toMatchObject({
      alternative: { name: "Indoor Museum", placeId: alternativePlaceId },
      confidence: { level: "high", score: 0.9 },
      impact: { impactId, reason: impact.summary },
      original: { itemId, name: "Garden walk", placeId: originalPlaceId },
    });
    expect(trip.days[0]?.items[0]?.placeId).toBe(originalPlaceId);
    expect(provider.calls).toEqual([
      expect.objectContaining({
        operation: "assistant",
        promptVersion: "disruption-alternative-v1",
      }),
    ]);
  });

  test("suppresses stale evidence and unauthorized replacement identifiers", async () => {
    const staleProvider = new FixtureAiProvider({ steps: [{ result: { value: output() } }] });
    await expect(service(staleProvider, "stale").generate({ impact, trip })).resolves.toBeNull();
    expect(staleProvider.calls).toHaveLength(0);

    const unknownProvider = new FixtureAiProvider({
      steps: [{ result: { value: output("90000000-0000-4000-8000-000000000009") } }],
    });
    await expect(service(unknownProvider).generate({ impact, trip })).resolves.toBeNull();
  });

  test("surfaces provider outages without fabricating an alternative", async () => {
    const provider = new FixtureAiProvider({
      steps: [{ error: { code: "unavailable", retryable: true } }],
    });
    await expect(service(provider).generate({ impact, trip })).rejects.toBeInstanceOf(
      DisruptionAlternativeGenerationError,
    );
  });
});
