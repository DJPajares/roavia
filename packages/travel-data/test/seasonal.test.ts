import { describe, expect, test } from "vitest";

import { computeSeasonalInsight, type SeasonalSignalEvidence } from "../src/seasonal.js";

const refreshedAt = "2026-08-01T10:00:00.000Z";

function evidence(
  input: Partial<SeasonalSignalEvidence> &
    Pick<SeasonalSignalEvidence, "favorability" | "signal" | "sourceId">,
): SeasonalSignalEvidence {
  return {
    confidence: 0.8,
    precision: input.signal === "crowds" || input.signal === "prices" ? "qualitative" : "measured",
    refreshedAt: "2026-07-30T10:00:00.000Z",
    summary: `${input.signal} fixture evidence`,
    ...input,
  };
}

describe("seasonal insight computation", () => {
  test("changes the recommendation when traveler priorities change", () => {
    const tokyoEvidence = [
      evidence({ favorability: 0.9, signal: "weather", sourceId: "source:climate-tokyo" }),
      evidence({ favorability: 0.85, signal: "rainfall", sourceId: "source:rain-tokyo" }),
      evidence({ favorability: 0.88, signal: "temperature", sourceId: "source:temp-tokyo" }),
      evidence({ favorability: 0.2, signal: "prices", sourceId: "source:price-tokyo" }),
      evidence({ favorability: 0.35, signal: "crowds", sourceId: "source:crowds-tokyo" }),
      evidence({ favorability: 0.75, signal: "festivals", sourceId: "source:event-tokyo" }),
    ];
    const weatherFirst = computeSeasonalInsight({
      evidence: tokyoEvidence,
      period: { kind: "month", month: 4, year: 2027 },
      placeId: "place:tokyo",
      priorities: { budget: 0.25, crowds: 0.25, festivals: 0.5, weather: 5 },
      refreshedAt,
    });
    const budgetFirst = computeSeasonalInsight({
      evidence: tokyoEvidence,
      period: { kind: "month", month: 4, year: 2027 },
      placeId: "place:tokyo",
      priorities: { budget: 5, crowds: 1, festivals: 0.25, weather: 0.25 },
      refreshedAt,
    });

    expect(weatherFirst.score).toBeGreaterThan(budgetFirst.score!);
    expect(weatherFirst.rating).toBe("very_favorable");
    expect(budgetFirst.rating).toBe("challenging");
    expect(weatherFirst.explanation.caveats).toContain(
      "This is a priority-based tradeoff view, not a universal best-time claim.",
    );
    expect(weatherFirst.explanation.caveats).toContain(
      "Crowd and price signals are qualitative estimates, not precise forecasts.",
    );
  });

  test("makes conflicting, missing, and stale evidence explicit", () => {
    const sydney = computeSeasonalInsight({
      evidence: [
        evidence({
          confidence: 0.9,
          favorability: 0.9,
          signal: "weather",
          sourceId: "source:climate-sydney-a",
        }),
        evidence({
          confidence: 0.8,
          favorability: 0.2,
          signal: "weather",
          sourceId: "source:climate-sydney-b",
        }),
        evidence({
          favorability: 0.7,
          signal: "festivals",
          sourceId: "source:event-sydney",
          staleAt: "2026-07-01T00:00:00.000Z",
        }),
        evidence({
          favorability: null,
          signal: "closures",
          sourceId: "source:closures-sydney",
        }),
      ],
      period: { endDate: "2027-01-15", kind: "date_range", startDate: "2027-01-05" },
      placeId: "place:sydney",
      priorities: { closures: 3, festivals: 2, weather: 4 },
      refreshedAt,
    });

    expect(sydney.periodKey).toBe("range:2027-01-05:2027-01-15");
    expect(sydney.signals.weather.state).toBe("conflicting");
    expect(sydney.signals.festivals.state).toBe("stale");
    expect(sydney.signals.closures.state).toBe("missing");
    expect(sydney.signals.weather.sourceIds).toEqual([
      "source:climate-sydney-a",
      "source:climate-sydney-b",
    ]);
    expect(sydney.signals.weather.evidence.map(({ confidence }) => confidence)).toEqual([0.9, 0.8]);
    expect(sydney.explanation.caveats.join(" ")).toMatch(/conflict|stale|unavailable/i);
  });

  test("rejects unsupported crowd and price precision", () => {
    expect(() =>
      computeSeasonalInsight({
        evidence: [
          evidence({
            favorability: 0.5,
            precision: "measured",
            signal: "prices",
            sourceId: "source:unsupported-price",
          }),
        ],
        period: { kind: "month", month: 8, year: 2027 },
        placeId: "place:singapore",
        refreshedAt,
      }),
    ).toThrow(/qualitative/);
  });
});
