export const seasonalSignals = [
  "weather",
  "rainfall",
  "temperature",
  "crowds",
  "prices",
  "festivals",
  "holidays",
  "closures",
] as const;

export type SeasonalSignal = (typeof seasonalSignals)[number];

export const seasonalPriorityKeys = [
  "weather",
  "budget",
  "crowds",
  "festivals",
  "closures",
] as const;

export type SeasonalPriorityKey = (typeof seasonalPriorityKeys)[number];
export type SeasonalPriorities = Partial<Record<SeasonalPriorityKey, number>>;

export type SeasonalPeriod =
  | { kind: "date_range"; endDate: string; startDate: string }
  | { kind: "month"; month: number; year: number };

export type SeasonalEvidencePrecision = "estimated" | "measured" | "qualitative";

export interface SeasonalSignalEvidence {
  /** Relative suitability from zero (challenging) to one (favorable). */
  favorability: number | null;
  /** Source-supplied or reviewed confidence from zero to one. */
  confidence: number;
  precision: SeasonalEvidencePrecision;
  refreshedAt: string;
  signal: SeasonalSignal;
  sourceId: string;
  staleAt?: string;
  summary: string;
}

export type SeasonalSignalState = "available" | "conflicting" | "missing" | "stale";

export interface SeasonalSignalInsight {
  confidence: number | null;
  evidence: readonly SeasonalSignalEvidence[];
  favorability: number | null;
  refreshedAt: string | null;
  sourceIds: readonly string[];
  state: SeasonalSignalState;
}

export type SeasonalRating =
  "challenging" | "favorable" | "insufficient_evidence" | "mixed" | "very_favorable";

export interface SeasonalExplanation {
  caveats: readonly string[];
  summary: string;
  tradeoffs: readonly string[];
}

export interface SeasonalInsight {
  confidence: number;
  explanation: SeasonalExplanation;
  period: SeasonalPeriod;
  periodKey: string;
  placeId: string;
  priorities: Record<SeasonalPriorityKey, number>;
  rating: SeasonalRating;
  refreshedAt: string;
  score: number | null;
  signals: Record<SeasonalSignal, SeasonalSignalInsight>;
  sourceIds: readonly string[];
}

export interface ComputeSeasonalInsightInput {
  evidence: readonly SeasonalSignalEvidence[];
  period: SeasonalPeriod;
  placeId: string;
  priorities?: SeasonalPriorities;
  refreshedAt: string;
}

const signalLabels: Record<SeasonalSignal, string> = {
  closures: "Closure",
  crowds: "Crowd",
  festivals: "Festival",
  holidays: "Holiday",
  prices: "Price",
  rainfall: "Rainfall",
  temperature: "Temperature",
  weather: "Weather",
};

const signalPriority: Record<SeasonalSignal, readonly [SeasonalPriorityKey, number]> = {
  closures: ["closures", 1],
  crowds: ["crowds", 1],
  festivals: ["festivals", 0.5],
  holidays: ["festivals", 0.5],
  prices: ["budget", 1],
  rainfall: ["weather", 1 / 3],
  temperature: ["weather", 1 / 3],
  weather: ["weather", 1 / 3],
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function isTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}

function isIsoDate(value: string) {
  if (!isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertUnitInterval(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be between zero and one.`);
  }
}

function assertPeriod(period: SeasonalPeriod) {
  if (period.kind === "month") {
    if (!Number.isInteger(period.year) || period.year < 1970 || period.year > 2100) {
      throw new Error("Seasonal month year must be between 1970 and 2100.");
    }
    if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
      throw new Error("Seasonal month must be between 1 and 12.");
    }
    return;
  }
  if (
    !isIsoDate(period.startDate) ||
    !isIsoDate(period.endDate) ||
    period.endDate < period.startDate
  ) {
    throw new Error("Seasonal date range must contain ordered ISO dates.");
  }
}

function assertEvidence(evidence: SeasonalSignalEvidence) {
  if (!seasonalSignals.includes(evidence.signal)) {
    throw new Error(`Unsupported seasonal signal: ${String(evidence.signal)}.`);
  }
  assertUnitInterval(evidence.confidence, "Seasonal evidence confidence");
  if (evidence.favorability !== null) {
    assertUnitInterval(evidence.favorability, "Seasonal evidence favorability");
  }
  if (!isTimestamp(evidence.refreshedAt) || (evidence.staleAt && !isTimestamp(evidence.staleAt))) {
    throw new Error("Seasonal evidence timestamps must be valid ISO timestamps.");
  }
  if (!evidence.sourceId.trim() || !evidence.summary.trim()) {
    throw new Error("Seasonal evidence requires a source ID and summary.");
  }
  if (
    (evidence.signal === "crowds" || evidence.signal === "prices") &&
    evidence.precision !== "qualitative"
  ) {
    throw new Error("Crowd and price evidence must remain qualitative.");
  }
}

export function seasonalPeriodKey(period: SeasonalPeriod) {
  assertPeriod(period);
  return period.kind === "month"
    ? `month:${period.year}-${String(period.month).padStart(2, "0")}`
    : `range:${period.startDate}:${period.endDate}`;
}

export function seasonalPeriodDates(period: SeasonalPeriod) {
  assertPeriod(period);
  if (period.kind === "date_range") {
    return { endDate: period.endDate, startDate: period.startDate };
  }
  const month = String(period.month).padStart(2, "0");
  const endDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  return {
    endDate: `${period.year}-${month}-${String(endDay).padStart(2, "0")}`,
    startDate: `${period.year}-${month}-01`,
  };
}

function normalizePriorities(input: SeasonalPriorities | undefined) {
  const priorities = Object.fromEntries(
    seasonalPriorityKeys.map((key) => [key, input?.[key] ?? 1]),
  ) as Record<SeasonalPriorityKey, number>;
  for (const [key, value] of Object.entries(priorities)) {
    if (!Number.isFinite(value) || value < 0 || value > 5) {
      throw new Error(`Seasonal priority ${key} must be between zero and five.`);
    }
  }
  return priorities;
}

function computeSignalInsight(
  signal: SeasonalSignal,
  evidence: readonly SeasonalSignalEvidence[],
  refreshedAt: string,
): SeasonalSignalInsight {
  const matching = evidence
    .filter((item) => item.signal === signal)
    .toSorted(
      (left, right) =>
        left.sourceId.localeCompare(right.sourceId) ||
        left.refreshedAt.localeCompare(right.refreshedAt),
    );
  const usable = matching.filter(
    (item): item is SeasonalSignalEvidence & { favorability: number } =>
      item.favorability !== null && item.confidence > 0,
  );
  const sourceIds = [...new Set(matching.map(({ sourceId }) => sourceId))].toSorted();
  const latestRefresh = matching.reduce<string | null>(
    (latest, item) => (!latest || item.refreshedAt > latest ? item.refreshedAt : latest),
    null,
  );

  if (usable.length === 0) {
    return {
      confidence: null,
      evidence: matching,
      favorability: null,
      refreshedAt: latestRefresh,
      sourceIds,
      state: "missing",
    };
  }

  const weighted = usable.map((item) => ({
    confidence:
      item.staleAt && Date.parse(item.staleAt) <= Date.parse(refreshedAt)
        ? item.confidence * 0.5
        : item.confidence,
    item,
  }));
  const confidenceTotal = weighted.reduce((total, item) => total + item.confidence, 0);
  const favorability =
    confidenceTotal > 0
      ? weighted.reduce((total, item) => total + item.item.favorability * item.confidence, 0) /
        confidenceTotal
      : usable.reduce((total, item) => total + item.favorability, 0) / usable.length;
  const spread =
    Math.max(...usable.map(({ favorability: value }) => value)) -
    Math.min(...usable.map(({ favorability: value }) => value));
  const conflicting = usable.length > 1 && spread >= 0.4;
  const allStale = usable.every(
    (item) => item.staleAt && Date.parse(item.staleAt) <= Date.parse(refreshedAt),
  );
  const averageConfidence = confidenceTotal / usable.length;

  return {
    confidence: round(averageConfidence * (conflicting ? 0.65 : 1)),
    evidence: matching,
    favorability: round(favorability),
    refreshedAt: latestRefresh,
    sourceIds,
    state: conflicting ? "conflicting" : allStale ? "stale" : "available",
  };
}

function ratingFor(score: number | null): SeasonalRating {
  if (score === null) return "insufficient_evidence";
  if (score >= 0.8) return "very_favorable";
  if (score >= 0.65) return "favorable";
  if (score >= 0.4) return "mixed";
  return "challenging";
}

function explanationFor(
  rating: SeasonalRating,
  signals: Record<SeasonalSignal, SeasonalSignalInsight>,
  priorities: Record<SeasonalPriorityKey, number>,
): SeasonalExplanation {
  const relevant = seasonalSignals
    .map((signal) => {
      const [priority, factor] = signalPriority[signal];
      return { insight: signals[signal], signal, weight: priorities[priority] * factor };
    })
    .filter(({ weight }) => weight > 0)
    .toSorted(
      (left, right) =>
        right.weight * (right.insight.confidence ?? 0) -
          left.weight * (left.insight.confidence ?? 0) || left.signal.localeCompare(right.signal),
    );
  const strengths = relevant.filter(
    ({ insight }) => insight.favorability !== null && insight.favorability >= 0.67,
  );
  const challenges = relevant.filter(
    ({ insight }) => insight.favorability !== null && insight.favorability <= 0.4,
  );
  const tradeoffs = [
    ...strengths.slice(0, 2).map(({ signal }) => `${signalLabels[signal]} is a relative strength.`),
    ...challenges
      .slice(0, 2)
      .map(({ signal }) => `${signalLabels[signal]} evidence points to a tradeoff.`),
  ];
  if (tradeoffs.length === 0)
    tradeoffs.push("The available signals do not show a clear advantage.");

  const conflicting = relevant
    .filter(({ insight }) => insight.state === "conflicting")
    .map(({ signal }) => signalLabels[signal].toLowerCase());
  const stale = relevant
    .filter(({ insight }) => insight.state === "stale")
    .map(({ signal }) => signalLabels[signal].toLowerCase());
  const missing = relevant
    .filter(({ insight }) => insight.state === "missing")
    .map(({ signal }) => signalLabels[signal].toLowerCase());
  const caveats = ["This is a priority-based tradeoff view, not a universal best-time claim."];
  if (conflicting.length > 0) caveats.push(`Sources conflict for ${conflicting.join(", ")}.`);
  if (stale.length > 0) caveats.push(`Evidence is stale for ${stale.join(", ")}.`);
  if (missing.length > 0) caveats.push(`Evidence is unavailable for ${missing.join(", ")}.`);
  if (signals.crowds.evidence.length > 0 || signals.prices.evidence.length > 0) {
    caveats.push("Crowd and price signals are qualitative estimates, not precise forecasts.");
  }

  const summary: Record<SeasonalRating, string> = {
    challenging: "Evidence suggests meaningful tradeoffs for the selected priorities.",
    favorable: "Evidence suggests a favorable period for the selected priorities.",
    insufficient_evidence: "There is not enough supported evidence to rate this period.",
    mixed: "Evidence is mixed for the selected priorities.",
    very_favorable:
      "Evidence suggests a particularly favorable period for the selected priorities.",
  };
  return { caveats, summary: summary[rating], tradeoffs };
}

export function computeSeasonalInsight(input: ComputeSeasonalInsightInput): SeasonalInsight {
  assertPeriod(input.period);
  if (!input.placeId.trim()) throw new Error("Seasonal insight requires a place ID.");
  if (!isTimestamp(input.refreshedAt)) {
    throw new Error("Seasonal insight refreshedAt must be a valid ISO timestamp.");
  }
  input.evidence.forEach(assertEvidence);

  const priorities = normalizePriorities(input.priorities);
  const signals = Object.fromEntries(
    seasonalSignals.map((signal) => [
      signal,
      computeSignalInsight(signal, input.evidence, input.refreshedAt),
    ]),
  ) as Record<SeasonalSignal, SeasonalSignalInsight>;
  const weighted = seasonalSignals.flatMap((signal) => {
    const insight = signals[signal];
    const [priority, factor] = signalPriority[signal];
    const weight = priorities[priority] * factor * (insight.confidence ?? 0);
    return insight.favorability === null || weight === 0
      ? []
      : [{ score: insight.favorability, weight }];
  });
  const weightTotal = weighted.reduce((total, item) => total + item.weight, 0);
  const score =
    weightTotal === 0
      ? null
      : round(weighted.reduce((total, item) => total + item.score * item.weight, 0) / weightTotal);
  const confidenceDenominator = seasonalSignals.reduce((total, signal) => {
    const [priority, factor] = signalPriority[signal];
    return total + priorities[priority] * factor;
  }, 0);
  const confidence =
    confidenceDenominator === 0
      ? 0
      : round(
          seasonalSignals.reduce((total, signal) => {
            const [priority, factor] = signalPriority[signal];
            return total + priorities[priority] * factor * (signals[signal].confidence ?? 0);
          }, 0) / confidenceDenominator,
        );
  const rating = ratingFor(score);

  return {
    confidence,
    explanation: explanationFor(rating, signals, priorities),
    period: input.period,
    periodKey: seasonalPeriodKey(input.period),
    placeId: input.placeId,
    priorities,
    rating,
    refreshedAt: input.refreshedAt,
    score,
    signals,
    sourceIds: [...new Set(input.evidence.map(({ sourceId }) => sourceId))].toSorted(),
  };
}
