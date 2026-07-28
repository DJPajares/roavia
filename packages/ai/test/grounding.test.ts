import { describe, expect, test } from "vitest";

import { GroundingRetriever, groundingContextSchema } from "../src/index.js";
import {
  FixtureGroundingDataSource,
  groundingCandidateFixture,
  officialGroundingSourceFixture,
} from "../src/testing.js";

const NOW = new Date("2026-07-28T08:00:00.000Z");
const baseRequest = {
  destinationIds: ["destination-singapore"],
  purpose: "itinerary" as const,
  query: "Gardens by the Bay tickets by MRT",
  requiredKinds: ["place"] as const,
};

describe("destination retrieval and grounding context", () => {
  test("ranks relevant evidence and preserves deduplicated source provenance", async () => {
    const gardens = groundingCandidateFixture({
      candidateId: "gardens-by-the-bay",
      content: "Gardens by the Bay has timed attraction tickets and nearby MRT access.",
      keywords: ["supertree", "tickets", "MRT"],
      kind: "place",
      title: "Gardens by the Bay",
    });
    const museum = groundingCandidateFixture({
      candidateId: "national-museum",
      content: "A museum with exhibits about Singapore history.",
      kind: "place",
      title: "National Museum of Singapore",
    });
    const retriever = new GroundingRetriever([
      new FixtureGroundingDataSource({ candidates: [museum, gardens] }),
    ]);

    const context = await retriever.retrieve(baseRequest, NOW);

    expect(groundingContextSchema.parse(context)).toEqual(context);
    expect(context.items.map((item) => item.candidateId)).toEqual([
      "gardens-by-the-bay",
      "national-museum",
    ]);
    expect(context.items[0]?.sourceIds).toEqual([officialGroundingSourceFixture.sourceId]);
    expect(context.sources).toEqual([officialGroundingSourceFixture]);
    expect(context.renderedContext).toContain("source_ids=source-singapore-official");
  });

  test("selects each required evidence kind before filling the remaining budget", async () => {
    const candidates = [
      groundingCandidateFixture({
        candidateId: "place-gardens",
        kind: "place",
        title: "Gardens by the Bay",
      }),
      groundingCandidateFixture({
        candidateId: "practical-tickets",
        kind: "practical",
        title: "Attraction ticket guidance",
      }),
      groundingCandidateFixture({
        candidateId: "season-rain",
        kind: "seasonality",
        title: "Northeast monsoon guidance",
      }),
      groundingCandidateFixture({
        candidateId: "route-mrt",
        kind: "route",
        title: "MRT route to Gardens by the Bay",
      }),
    ];
    const retriever = new GroundingRetriever([new FixtureGroundingDataSource({ candidates })]);

    const context = await retriever.retrieve(
      {
        ...baseRequest,
        budget: { maxItems: 4 },
        requiredKinds: ["place", "practical", "seasonality", "route"],
      },
      NOW,
    );

    expect(new Set(context.items.map((item) => item.kind))).toEqual(
      new Set(["place", "practical", "seasonality", "route"]),
    );
    expect(context.status).toBe("complete");
  });

  test("makes stale, expired, and absent evidence explicit", async () => {
    const staleRoute = groundingCandidateFixture({
      candidateId: "stale-route",
      freshness: {
        expiresAt: "2026-08-01T00:00:00.000Z",
        observedAt: "2026-06-01T00:00:00.000Z",
        staleAt: "2026-07-01T00:00:00.000Z",
        state: "stale",
      },
      kind: "route",
      title: "Stale MRT route",
    });
    const expiredSeason = groundingCandidateFixture({
      candidateId: "expired-season",
      freshness: {
        expiresAt: "2026-07-01T00:00:00.000Z",
        observedAt: "2026-01-01T00:00:00.000Z",
        staleAt: "2026-06-01T00:00:00.000Z",
        state: "expired",
      },
      kind: "seasonality",
      title: "Expired seasonality",
    });
    const retriever = new GroundingRetriever([
      new FixtureGroundingDataSource({ candidates: [staleRoute, expiredSeason] }),
    ]);

    const context = await retriever.retrieve(
      { ...baseRequest, requiredKinds: ["route", "seasonality", "practical"] },
      NOW,
    );

    expect(context.items).toHaveLength(1);
    expect(context.items[0]?.candidateId).toBe("stale-route");
    expect(context.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "route", reason: "stale_only" }),
        expect.objectContaining({ kind: "seasonality", reason: "expired_only" }),
        expect.objectContaining({ kind: "practical", reason: "missing_kind" }),
      ]),
    );
    expect(context.status).toBe("partial");
  });

  test("surfaces conflicting facts with each variant's candidates and sources", async () => {
    const morning = groundingCandidateFixture({
      candidateId: "hours-morning",
      facts: [{ key: "opening_time", value: "09:00" }],
      kind: "practical",
      title: "Official opening time",
    });
    const later = groundingCandidateFixture({
      candidateId: "hours-later",
      facts: [{ key: "opening_time", value: "10:00" }],
      kind: "practical",
      title: "Alternate opening time",
    });
    const retriever = new GroundingRetriever([
      new FixtureGroundingDataSource({ candidates: [morning, later] }),
    ]);

    const context = await retriever.retrieve({ ...baseRequest, requiredKinds: ["practical"] }, NOW);

    expect(context.conflicts).toEqual([
      {
        factKey: "opening_time",
        variants: expect.arrayContaining([
          expect.objectContaining({ candidateIds: ["hours-morning"], value: "09:00" }),
          expect.objectContaining({ candidateIds: ["hours-later"], value: "10:00" }),
        ]),
      },
    ]);
    expect(context.status).toBe("partial");
  });

  test("enforces item, source, character, and rendered-token budgets", async () => {
    const candidates = Array.from({ length: 4 }, (_, index) =>
      groundingCandidateFixture({
        candidateId: `candidate-${index}`,
        content: `${"Detailed evidence ".repeat(100)}${index}`,
        kind: "place",
        title: `Singapore place ${index}`,
      }),
    );
    const retriever = new GroundingRetriever([new FixtureGroundingDataSource({ candidates })]);

    const context = await retriever.retrieve(
      {
        ...baseRequest,
        budget: {
          maxEstimatedTokens: 128,
          maxItemCharacters: 100,
          maxItems: 1,
          maxSources: 1,
        },
      },
      NOW,
    );

    expect(context.items.length).toBeLessThanOrEqual(1);
    expect(context.sources.length).toBeLessThanOrEqual(1);
    expect(context.items.every((item) => item.content.length <= 100)).toBe(true);
    expect(context.budget.usedEstimatedTokens).toBeLessThanOrEqual(128);
    expect(context.budget.truncated).toBe(true);
    expect(context.gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "budget_exhausted" })]),
    );
  });

  test("keeps authorized trip context minimal and separate from sourced evidence", async () => {
    const retriever = new GroundingRetriever([new FixtureGroundingDataSource({ candidates: [] })]);

    const context = await retriever.retrieve(
      {
        ...baseRequest,
        requiredKinds: ["practical"],
        tripContext: {
          dateWindow: { endDate: "2026-10-12", startDate: "2026-10-10" },
          destinationNames: ["Singapore"],
          interests: ["gardens"],
          pace: "balanced",
          title: "Singapore weekend",
        },
      },
      NOW,
    );

    expect(context.tripContext).toEqual({
      dateWindow: { endDate: "2026-10-12", startDate: "2026-10-10" },
      destinationNames: ["Singapore"],
      interests: ["gardens"],
      pace: "balanced",
      title: "Singapore weekend",
    });
    expect(context.sources).toEqual([]);
    expect(context.items).toEqual([]);
    expect(context.gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "missing_kind" })]),
    );
    expect(context.renderedContext).toContain("AUTHORIZED TRIP CONTEXT");
  });

  test("returns an explicit empty context and sanitizes source failures", async () => {
    const retriever = new GroundingRetriever([
      new FixtureGroundingDataSource({
        name: "broken-live-source",
        rejection: new Error("provider credential super-secret-value"),
      }),
    ]);

    const context = await retriever.retrieve(baseRequest, NOW);

    expect(context.status).toBe("empty");
    expect(context.items).toEqual([]);
    expect(context.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "source_unavailable", sourceName: "broken-live-source" }),
        expect.objectContaining({ kind: "place", reason: "missing_kind" }),
      ]),
    );
    expect(JSON.stringify(context)).not.toContain("super-secret-value");
  });
});
