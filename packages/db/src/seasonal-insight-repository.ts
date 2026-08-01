import { createHash } from "node:crypto";

import { and, eq, ne } from "drizzle-orm";

import type { Database } from "./client.js";
import { seasonalInsights } from "./schema.js";

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
