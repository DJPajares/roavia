import { createHash } from "node:crypto";

import { and, desc, eq, inArray, ne } from "drizzle-orm";

import type { Database } from "./client.js";
import { places, seasonalInsights, sources } from "./schema.js";

export interface SeasonalInsightRefreshResult {
  outcome: "created" | "unchanged" | "updated";
  preservedReviewedOverride: boolean;
  recordId: string;
}

export interface PersistedSeasonalInsight extends Record<string, unknown> {
  period:
    | { endDate: string; kind: "date_range"; startDate: string }
    | { kind: "month"; month: number; year: number };
  periodKey: string;
  placeId: string;
  refreshedAt: string;
  sourceIds: readonly string[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function computedHash(insight: PersistedSeasonalInsight) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(insight)))
    .digest("hex");
}

function periodDates(period: PersistedSeasonalInsight["period"]) {
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

/**
 * Upserts computed evidence by place and period. Editorial overrides are never
 * part of the update set, so refreshes cannot silently replace reviewed work.
 */
export async function upsertSeasonalInsight(
  db: Database,
  insight: PersistedSeasonalInsight,
): Promise<SeasonalInsightRefreshResult> {
  const hash = computedHash(insight);
  const { endDate, startDate } = periodDates(insight.period);
  const values = {
    computedHash: hash,
    computedInsight: { ...insight },
    periodEnd: endDate,
    periodKey: insight.periodKey,
    periodKind: insight.period.kind,
    periodStart: startDate,
    placeId: insight.placeId,
    refreshedAt: new Date(insight.refreshedAt),
    sourceIds: [...insight.sourceIds],
  };
  const inserted = await db
    .insert(seasonalInsights)
    .values(values)
    .onConflictDoNothing({
      target: [seasonalInsights.placeId, seasonalInsights.periodKey],
    })
    .returning({ id: seasonalInsights.id });
  if (inserted[0]) {
    return {
      outcome: "created",
      preservedReviewedOverride: false,
      recordId: inserted[0].id,
    };
  }

  const updated = await db
    .update(seasonalInsights)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(
        eq(seasonalInsights.placeId, insight.placeId),
        eq(seasonalInsights.periodKey, insight.periodKey),
        ne(seasonalInsights.computedHash, hash),
      ),
    )
    .returning({
      id: seasonalInsights.id,
      reviewedOverride: seasonalInsights.reviewedOverride,
    });
  if (updated[0]) {
    return {
      outcome: "updated",
      preservedReviewedOverride: updated[0].reviewedOverride !== null,
      recordId: updated[0].id,
    };
  }

  const current = await db
    .select({
      id: seasonalInsights.id,
      reviewedOverride: seasonalInsights.reviewedOverride,
    })
    .from(seasonalInsights)
    .where(
      and(
        eq(seasonalInsights.placeId, insight.placeId),
        eq(seasonalInsights.periodKey, insight.periodKey),
      ),
    );
  if (!current[0]) throw new Error("Seasonal insight disappeared during idempotent refresh.");
  return {
    outcome: "unchanged",
    preservedReviewedOverride: current[0].reviewedOverride !== null,
    recordId: current[0].id,
  };
}

export async function getSeasonalInsight(db: Database, placeId: string, periodKey: string) {
  const rows = await db
    .select({
      computedInsight: seasonalInsights.computedInsight,
      id: seasonalInsights.id,
      refreshedAt: seasonalInsights.refreshedAt,
      reviewedAt: seasonalInsights.reviewedAt,
      reviewedBy: seasonalInsights.reviewedBy,
      reviewedOverride: seasonalInsights.reviewedOverride,
      sourceIds: seasonalInsights.sourceIds,
    })
    .from(seasonalInsights)
    .where(and(eq(seasonalInsights.placeId, placeId), eq(seasonalInsights.periodKey, periodKey)));
  return rows[0] ?? null;
}

export interface ExploreSeasonalCollection {
  destination: {
    countryCode: string | null;
    id: string;
    name: string;
    type: "city" | "country" | "district" | "poi" | "region" | "transit_hub";
  };
  freshness: "fresh" | "partial" | "stale";
  period: { endDate: string; startDate: string };
  rating: "challenging" | "favorable" | "insufficient_evidence" | "mixed" | "very_favorable";
  reason: string;
  refreshedAt: Date;
  sources: Array<{ id: string; retrievedAt: Date; title: string | null; url: string }>;
  tradeoffs: string[];
}

/**
 * Public discovery data intentionally includes only persisted, evidence-backed
 * seasonal insights. It does not rank destinations or infer recommendations.
 */
export async function listExploreSeasonalCollections(
  db: Database,
  options: { limit?: number; now?: Date } = {},
): Promise<ExploreSeasonalCollection[]> {
  const limit = options.limit ?? 6;
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) {
    throw new RangeError("Explore seasonal collection queries require a limit between 1 and 12.");
  }
  const now = options.now ?? new Date();
  const rows = await db
    .select({
      computedInsight: seasonalInsights.computedInsight,
      countryCode: places.countryCode,
      periodEnd: seasonalInsights.periodEnd,
      periodStart: seasonalInsights.periodStart,
      placeId: places.id,
      placeName: places.canonicalName,
      placeType: places.placeType,
      refreshedAt: seasonalInsights.refreshedAt,
      sourceIds: seasonalInsights.sourceIds,
    })
    .from(seasonalInsights)
    .innerJoin(places, eq(seasonalInsights.placeId, places.id))
    .where(eq(places.status, "active"))
    .orderBy(desc(seasonalInsights.refreshedAt), desc(seasonalInsights.periodStart))
    .limit(limit);
  const sourceIds = [...new Set(rows.flatMap((row) => row.sourceIds))].filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
  );
  const sourceRows = sourceIds.length
    ? await db
        .select({
          id: sources.id,
          retrievedAt: sources.retrievedAt,
          title: sources.title,
          url: sources.sourceUrl,
        })
        .from(sources)
        .where(inArray(sources.id, sourceIds))
    : [];
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));

  return rows.flatMap((row) => {
    const insight = row.computedInsight as {
      explanation?: { summary?: unknown; tradeoffs?: unknown };
      rating?: unknown;
    };
    const reason = insight.explanation?.summary;
    const rating = insight.rating;
    if (
      typeof reason !== "string" ||
      !reason.trim() ||
      !["challenging", "favorable", "insufficient_evidence", "mixed", "very_favorable"].includes(
        String(rating),
      )
    ) {
      return [];
    }
    const collectionSources = row.sourceIds.flatMap((id) => {
      const source = sourceById.get(id);
      return source ? [source] : [];
    });
    const stale = now.getTime() - row.refreshedAt.getTime() > 90 * 24 * 60 * 60 * 1_000;
    const freshness = stale ? "stale" : collectionSources.length === 0 ? "partial" : "fresh";
    return [
      {
        destination: {
          countryCode: row.countryCode,
          id: row.placeId,
          name: row.placeName,
          type: row.placeType as ExploreSeasonalCollection["destination"]["type"],
        },
        freshness,
        period: { endDate: row.periodEnd, startDate: row.periodStart },
        rating: rating as ExploreSeasonalCollection["rating"],
        reason,
        refreshedAt: row.refreshedAt,
        sources: collectionSources,
        tradeoffs: Array.isArray(insight.explanation?.tradeoffs)
          ? insight.explanation.tradeoffs.filter((item): item is string => typeof item === "string")
          : [],
      },
    ];
  });
}
