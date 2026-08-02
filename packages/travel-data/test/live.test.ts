import { describe, expect, test } from "vitest";

import {
  evaluateLiveConditions,
  type LiveConditionBatch,
  type LiveConditionEvent,
  type LiveConditionTarget,
} from "../src/index.js";

const now = new Date("2026-08-02T08:00:00.000Z");
const tripId = "47000000-0000-4000-8000-000000000001";
const placeId = "47000000-0000-4000-8000-000000000002";
const itineraryItemId = "47000000-0000-4000-8000-000000000003";

const target: LiveConditionTarget = {
  coordinates: { latitude: 1.3521, longitude: 103.8198 },
  itineraryItemId,
  localDate: "2026-08-05",
  placeId,
  timezone: "Asia/Singapore",
  tripId,
};

function event(overrides: Partial<LiveConditionEvent> = {}): LiveConditionEvent {
  return {
    confidence: 0.88,
    endDate: "2026-08-05",
    eventId: "forecast:2026-08-05:thunderstorm",
    kind: "weather",
    placeId,
    provider: "weather-fixture",
    severity: "high",
    source: {
      offlineUseAllowed: true,
      provider: "weather-fixture",
      redistributionAllowed: true,
      retrievedAt: "2026-08-02T07:55:00.000Z",
      sourceUrl: "https://weather.example.test/forecast",
      title: "Fixture weather service",
    },
    startDate: "2026-08-05",
    summary: "A materially stronger thunderstorm signal overlaps this activity.",
    updatedAt: "2026-08-02T07:50:00.000Z",
    ...overrides,
  };
}

function batch(
  events: readonly LiveConditionEvent[],
  overrides: Partial<LiveConditionBatch> = {},
): LiveConditionBatch {
  return {
    checkedAt: now.toISOString(),
    events,
    kind: "weather",
    placeId,
    provider: "weather-fixture",
    state: "fresh",
    ...overrides,
  };
}

describe("live-condition impact evaluation", () => {
  test("normalizes changed weather and closure events without editing the target", () => {
    const weather = event();
    const closure = event({
      eventId: "closure:gardens-by-the-bay:2026-08-05",
      kind: "closure",
      provider: "closure-fixture",
      severity: "critical",
      source: {
        offlineUseAllowed: false,
        provider: "closure-fixture",
        redistributionAllowed: true,
        retrievedAt: "2026-08-02T07:58:00.000Z",
        sourceKind: "official_operator",
        sourceUrl: "https://operator.example.test/closures/august-5",
        title: "Official attraction operator",
      },
      summary: "The attraction is closed during the planned visit.",
    });
    const originalTarget = structuredClone(target);
    const result = evaluateLiveConditions(
      [target],
      [batch([weather]), batch([closure], { kind: "closure", provider: "closure-fixture" })],
      { now },
    );

    expect(result.impacts).toHaveLength(2);
    expect(result.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itineraryItemId,
          kind: "weather",
          severity: "high",
          sourceUpdatedAt: weather.updatedAt,
        }),
        expect.objectContaining({
          itineraryItemId,
          kind: "closure",
          severity: "critical",
          sourceUrl: closure.source.sourceUrl,
        }),
      ]),
    );
    expect(target).toEqual(originalTarget);
  });

  test("suppresses low-confidence, low-impact, stale, and unavailable changes", () => {
    const result = evaluateLiveConditions(
      [target],
      [
        batch([event({ confidence: 0.4, eventId: "low-confidence" })]),
        batch([event({ eventId: "low-impact", severity: "low" })]),
        batch([event({ eventId: "expired", staleAt: "2026-08-01T00:00:00.000Z" })]),
        batch([event({ eventId: "stale-batch" })], { state: "stale" }),
        batch([], { provider: "outage-fixture", state: "unavailable" }),
      ],
      { now },
    );

    expect(result.impacts).toEqual([]);
    expect(result.ignored).toMatchObject({
      lowConfidence: 1,
      lowImpact: 1,
      stale: 2,
      unavailableBatches: 1,
    });
    expect(result.observations).toHaveLength(3);
    expect(result.observations[0]?.impactKeys).toEqual([
      `weather:weather-fixture:low-confidence:${itineraryItemId}`,
    ]);
  });

  test("deduplicates repeated provider events by item and stable event identity", () => {
    const duplicate = event();
    const result = evaluateLiveConditions([target], [batch([duplicate, duplicate])], { now });

    expect(result.impacts).toHaveLength(1);
    expect(result.ignored.duplicates).toBe(1);
    expect(result.observations[0]?.impactKeys).toEqual([result.impacts[0]?.impactKey]);
  });
});
