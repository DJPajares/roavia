import { createHash } from "node:crypto";

import { and, asc, eq, gte, isNotNull, lte, ne, notInArray, or } from "drizzle-orm";

import type { Database } from "./client.js";
import { itineraryDays, itineraryItems, liveConditionImpacts, places, trips } from "./schema.js";

export type LiveConditionImpactKind = "closure" | "weather";
export type LiveConditionImpactSeverity = "critical" | "high" | "low" | "moderate";

export interface LiveConditionTargetRecord {
  coordinates: { latitude: number; longitude: number };
  itineraryItemId: string;
  localDate: string;
  placeId: string;
  timezone: string;
  tripId: string;
}

export interface PersistedLiveConditionImpactInput {
  confidence: number;
  endDate: string;
  impactKey: string;
  itineraryItemId: string;
  kind: LiveConditionImpactKind;
  placeId: string;
  provider: string;
  providerEventId: string;
  severity: LiveConditionImpactSeverity;
  sourceRetrievedAt: string;
  sourceTitle: string | null;
  sourceUpdatedAt: string;
  sourceUrl: string;
  startDate: string;
  summary: string;
  tripId: string;
}

export interface LiveConditionObservationInput {
  impactKeys: readonly string[];
  kind: LiveConditionImpactKind;
  placeId: string;
  provider: string;
}

export interface LiveConditionPersistenceSummary {
  created: number;
  resolved: number;
  unchanged: number;
  updated: number;
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string, name: string) {
  if (!isoDatePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must be an ISO date.`);
  }
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

function impactHash(impact: PersistedLiveConditionImpactInput) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(impact)))
    .digest("hex");
}

export async function listUpcomingLiveConditionTripIds(
  db: Database,
  input: { asOfDate: string; horizonEndDate: string },
) {
  assertDate(input.asOfDate, "Live-condition window start");
  assertDate(input.horizonEndDate, "Live-condition window end");
  if (input.horizonEndDate < input.asOfDate) {
    throw new Error("Live-condition targeting window is reversed.");
  }
  const rows = await db
    .selectDistinct({ tripId: trips.id })
    .from(trips)
    .innerJoin(itineraryDays, eq(itineraryDays.tripId, trips.id))
    .innerJoin(itineraryItems, eq(itineraryItems.itineraryDayId, itineraryDays.id))
    .innerJoin(places, eq(places.id, itineraryItems.placeId))
    .where(
      and(
        eq(trips.status, "active"),
        gte(itineraryDays.localDate, input.asOfDate),
        lte(itineraryDays.localDate, input.horizonEndDate),
        isNotNull(itineraryItems.placeId),
        isNotNull(places.latitude),
        isNotNull(places.longitude),
        isNotNull(places.timezone),
      ),
    )
    .orderBy(asc(trips.id));
  return rows.map(({ tripId }) => tripId);
}

export async function getUpcomingLiveConditionTargets(
  db: Database,
  input: { asOfDate: string; horizonEndDate: string; tripId: string },
): Promise<LiveConditionTargetRecord[]> {
  assertDate(input.asOfDate, "Live-condition window start");
  assertDate(input.horizonEndDate, "Live-condition window end");
  if (input.horizonEndDate < input.asOfDate) {
    throw new Error("Live-condition targeting window is reversed.");
  }
  const rows = await db
    .select({
      itineraryItemId: itineraryItems.id,
      latitude: places.latitude,
      localDate: itineraryDays.localDate,
      longitude: places.longitude,
      placeId: places.id,
      timezone: places.timezone,
      tripId: trips.id,
    })
    .from(trips)
    .innerJoin(itineraryDays, eq(itineraryDays.tripId, trips.id))
    .innerJoin(itineraryItems, eq(itineraryItems.itineraryDayId, itineraryDays.id))
    .innerJoin(places, eq(places.id, itineraryItems.placeId))
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.status, "active"),
        gte(itineraryDays.localDate, input.asOfDate),
        lte(itineraryDays.localDate, input.horizonEndDate),
        isNotNull(itineraryItems.placeId),
        isNotNull(places.latitude),
        isNotNull(places.longitude),
        isNotNull(places.timezone),
      ),
    )
    .orderBy(asc(itineraryDays.localDate), asc(itineraryItems.orderIndex));

  return rows.map((row) => {
    if (row.latitude === null || row.longitude === null || row.timezone === null) {
      throw new Error("Live-condition target lost required place context.");
    }
    return {
      coordinates: { latitude: row.latitude, longitude: row.longitude },
      itineraryItemId: row.itineraryItemId,
      localDate: row.localDate,
      placeId: row.placeId,
      timezone: row.timezone,
      tripId: row.tripId,
    };
  });
}

/**
 * Applies only fresh provider observations. Identical events are no-ops, and
 * missing events are resolved only for the explicitly observed provider scope.
 */
export async function reconcileLiveConditionImpacts(
  db: Database,
  input: {
    checkedAt: Date;
    impacts: readonly PersistedLiveConditionImpactInput[];
    observations: readonly LiveConditionObservationInput[];
    tripId: string;
  },
): Promise<LiveConditionPersistenceSummary> {
  const scopes = new Set<string>();
  for (const observation of input.observations) {
    const scope = `${observation.kind}:${observation.provider}:${observation.placeId}`;
    if (scopes.has(scope)) throw new Error("Live-condition provider observations must be unique.");
    scopes.add(scope);
  }
  for (const impact of input.impacts) {
    if (impact.tripId !== input.tripId) {
      throw new Error("Live-condition impacts must belong to the reconciled trip.");
    }
    if (!scopes.has(`${impact.kind}:${impact.provider}:${impact.placeId}`)) {
      throw new Error("Live-condition impacts require a fresh provider observation.");
    }
  }

  return db.transaction(async (transaction) => {
    const summary: LiveConditionPersistenceSummary = {
      created: 0,
      resolved: 0,
      unchanged: 0,
      updated: 0,
    };

    for (const impact of input.impacts) {
      const payloadHash = impactHash(impact);
      const values = {
        confidence: impact.confidence,
        firstObservedAt: input.checkedAt,
        impactEnd: impact.endDate,
        impactKey: impact.impactKey,
        impactStart: impact.startDate,
        itineraryItemId: impact.itineraryItemId,
        kind: impact.kind,
        lastChangedAt: input.checkedAt,
        payloadHash,
        placeId: impact.placeId,
        provider: impact.provider,
        providerEventId: impact.providerEventId,
        severity: impact.severity,
        sourceRetrievedAt: new Date(impact.sourceRetrievedAt),
        sourceTitle: impact.sourceTitle,
        sourceUpdatedAt: new Date(impact.sourceUpdatedAt),
        sourceUrl: impact.sourceUrl,
        state: "active" as const,
        summary: impact.summary,
        tripId: impact.tripId,
      };
      const inserted = await transaction
        .insert(liveConditionImpacts)
        .values(values)
        .onConflictDoNothing({ target: liveConditionImpacts.impactKey })
        .returning({ id: liveConditionImpacts.id });
      if (inserted[0]) {
        summary.created += 1;
        continue;
      }
      const updated = await transaction
        .update(liveConditionImpacts)
        .set({
          ...values,
          firstObservedAt: liveConditionImpacts.firstObservedAt,
          resolvedAt: null,
          updatedAt: input.checkedAt,
        })
        .where(
          and(
            eq(liveConditionImpacts.impactKey, impact.impactKey),
            or(
              ne(liveConditionImpacts.payloadHash, payloadHash),
              eq(liveConditionImpacts.state, "resolved"),
            ),
          ),
        )
        .returning({ id: liveConditionImpacts.id });
      if (updated[0]) summary.updated += 1;
      else summary.unchanged += 1;
    }

    for (const observation of input.observations) {
      const base = and(
        eq(liveConditionImpacts.tripId, input.tripId),
        eq(liveConditionImpacts.kind, observation.kind),
        eq(liveConditionImpacts.placeId, observation.placeId),
        eq(liveConditionImpacts.provider, observation.provider),
        eq(liveConditionImpacts.state, "active"),
      );
      const resolved = await transaction
        .update(liveConditionImpacts)
        .set({ resolvedAt: input.checkedAt, state: "resolved", updatedAt: input.checkedAt })
        .where(
          observation.impactKeys.length > 0
            ? and(base, notInArray(liveConditionImpacts.impactKey, [...observation.impactKeys]))
            : base,
        )
        .returning({ id: liveConditionImpacts.id });
      summary.resolved += resolved.length;
    }

    return summary;
  });
}

export async function listLiveConditionImpacts(db: Database, tripId: string) {
  return db
    .select()
    .from(liveConditionImpacts)
    .where(eq(liveConditionImpacts.tripId, tripId))
    .orderBy(asc(liveConditionImpacts.impactKey));
}
