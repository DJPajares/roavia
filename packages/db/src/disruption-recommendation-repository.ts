import {
  disruptionRecommendationSchema,
  disruptionRecommendationSnapshotSchema,
  type DisruptionRecommendation,
  type DisruptionRecommendationSnapshot,
} from "@roavia/contracts";
import { and, asc, desc, eq, gt, gte, inArray, ne } from "drizzle-orm";

import { AuthorizedResourceNotFoundError } from "./authorization.js";
import type { Database } from "./client.js";
import {
  disruptionRecommendations,
  itineraryDays,
  itineraryItems,
  liveConditionImpacts,
  places,
  trips,
  users,
} from "./schema.js";

const DEFAULT_MAX_IMPACT_AGE_MS = 24 * 60 * 60 * 1_000;
const MINIMUM_RECOMMENDATION_CONFIDENCE = 0.75;
const MAXIMUM_GENERATION_CANDIDATES = 3;

export class DisruptionRecommendationConflictError extends Error {
  readonly code = "disruption_recommendation_conflict" as const;

  constructor(message = "This disruption recommendation is no longer available.") {
    super(message);
    this.name = "DisruptionRecommendationConflictError";
  }
}

export interface DisruptionImpactCandidate {
  confidence: number;
  impactId: string;
  impactKey: string;
  itemType: DisruptionRecommendationSnapshot["original"]["itemType"];
  itineraryItemId: string;
  kind: DisruptionRecommendationSnapshot["impact"]["kind"];
  localDate: string;
  originalName: string;
  originalPlaceId: string;
  provider: string;
  severity: DisruptionRecommendationSnapshot["impact"]["severity"];
  sourceRetrievedAt: string;
  sourceTitle: string;
  sourceUpdatedAt: string;
  sourceUrl: string;
  startTime: string | null;
  summary: string;
  tripId: string;
}

export interface DisruptionGenerationState {
  candidates: DisruptionImpactCandidate[];
  hasActiveImpacts: boolean;
  hasLowConfidenceImpacts: boolean;
  hasStaleImpacts: boolean;
}

export interface DisruptionRecommendationRepository {
  generationState(
    authUserId: string,
    tripId: string,
    context?: { maxImpactAgeMs?: number; now?: Date },
  ): Promise<DisruptionGenerationState>;
  list(
    authUserId: string,
    tripId: string,
    context?: { maxImpactAgeMs?: number; now?: Date },
  ): Promise<DisruptionRecommendation[]>;
  create(
    authUserId: string,
    snapshot: DisruptionRecommendationSnapshot,
    context?: { maxImpactAgeMs?: number; now?: Date },
  ): Promise<DisruptionRecommendation | null>;
  decide(
    authUserId: string,
    tripId: string,
    recommendationId: string,
    decision: "dismiss" | "keep",
    context?: { now?: Date },
  ): Promise<{ recommendationId: string; status: "dismissed" | "kept"; tripId: string }>;
  beginApply(
    authUserId: string,
    tripId: string,
    recommendationId: string,
    context?: { maxImpactAgeMs?: number; now?: Date },
  ): Promise<DisruptionRecommendationSnapshot>;
  finishApply(
    recommendationId: string,
    outcome: { actionId?: string; failureCode?: string; status: "applied" | "failed" },
    context?: { now?: Date },
  ): Promise<void>;
}

function cutoffAt(now: Date, maxImpactAgeMs = DEFAULT_MAX_IMPACT_AGE_MS) {
  if (!Number.isInteger(maxImpactAgeMs) || maxImpactAgeMs <= 0) {
    throw new RangeError("Live disruption freshness requires a positive millisecond window.");
  }
  return new Date(now.getTime() - maxImpactAgeMs);
}

function serializeRecommendation(
  row: typeof disruptionRecommendations.$inferSelect,
): DisruptionRecommendation {
  if (row.status !== "pending" && row.status !== "applying" && row.status !== "failed") {
    throw new Error(
      "Resolved disruption decisions cannot be serialized as active recommendations.",
    );
  }
  return disruptionRecommendationSchema.parse({
    ...disruptionRecommendationSnapshotSchema.parse(row.snapshot),
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    status: row.status,
  });
}

export function createDisruptionRecommendationRepository(
  db: Database,
): DisruptionRecommendationRepository {
  return {
    async generationState(authUserId, tripId, context = {}) {
      const now = context.now ?? new Date();
      const cutoff = cutoffAt(now, context.maxImpactAgeMs);
      const rows = await db
        .select({
          confidence: liveConditionImpacts.confidence,
          hasRecommendation: disruptionRecommendations.id,
          impactId: liveConditionImpacts.id,
          impactKey: liveConditionImpacts.impactKey,
          itemType: itineraryItems.itemType,
          itineraryItemId: itineraryItems.id,
          kind: liveConditionImpacts.kind,
          localDate: itineraryDays.localDate,
          originalName: places.canonicalName,
          originalPlaceId: places.id,
          provider: liveConditionImpacts.provider,
          severity: liveConditionImpacts.severity,
          sourceRetrievedAt: liveConditionImpacts.sourceRetrievedAt,
          sourceTitle: liveConditionImpacts.sourceTitle,
          sourceUpdatedAt: liveConditionImpacts.sourceUpdatedAt,
          sourceUrl: liveConditionImpacts.sourceUrl,
          startTime: itineraryItems.startTime,
          summary: liveConditionImpacts.summary,
          tripId: trips.id,
        })
        .from(liveConditionImpacts)
        .innerJoin(trips, eq(liveConditionImpacts.tripId, trips.id))
        .innerJoin(users, eq(trips.ownerUserId, users.id))
        .innerJoin(itineraryItems, eq(liveConditionImpacts.itineraryItemId, itineraryItems.id))
        .innerJoin(itineraryDays, eq(itineraryItems.itineraryDayId, itineraryDays.id))
        .innerJoin(places, eq(itineraryItems.placeId, places.id))
        .leftJoin(
          disruptionRecommendations,
          eq(disruptionRecommendations.liveConditionImpactId, liveConditionImpacts.id),
        )
        .where(
          and(
            eq(users.authUserId, authUserId),
            eq(trips.id, tripId),
            eq(trips.status, "active"),
            eq(liveConditionImpacts.state, "active"),
            eq(liveConditionImpacts.placeId, places.id),
            ne(liveConditionImpacts.severity, "low"),
          ),
        )
        .orderBy(desc(liveConditionImpacts.severity), asc(liveConditionImpacts.impactKey));

      if (rows.length === 0) {
        const [ownedTrip] = await db
          .select({ id: trips.id })
          .from(trips)
          .innerJoin(users, eq(trips.ownerUserId, users.id))
          .where(and(eq(trips.id, tripId), eq(users.authUserId, authUserId)))
          .limit(1);
        if (!ownedTrip) throw new AuthorizedResourceNotFoundError();
      }

      const candidates = rows
        .filter(
          (row) =>
            row.hasRecommendation === null &&
            row.confidence >= MINIMUM_RECOMMENDATION_CONFIDENCE &&
            row.sourceRetrievedAt > cutoff,
        )
        .slice(0, MAXIMUM_GENERATION_CANDIDATES)
        .map((row): DisruptionImpactCandidate => ({
          confidence: row.confidence,
          impactId: row.impactId,
          impactKey: row.impactKey,
          itemType: row.itemType,
          itineraryItemId: row.itineraryItemId,
          kind: row.kind,
          localDate: row.localDate,
          originalName: row.originalName,
          originalPlaceId: row.originalPlaceId,
          provider: row.provider,
          severity: row.severity as DisruptionImpactCandidate["severity"],
          sourceRetrievedAt: row.sourceRetrievedAt.toISOString(),
          sourceTitle: row.sourceTitle ?? row.provider,
          sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
          sourceUrl: row.sourceUrl,
          startTime: row.startTime,
          summary: row.summary,
          tripId: row.tripId,
        }));

      return {
        candidates,
        hasActiveImpacts: rows.length > 0,
        hasLowConfidenceImpacts: rows.some(
          (row) => row.confidence < MINIMUM_RECOMMENDATION_CONFIDENCE,
        ),
        hasStaleImpacts: rows.some((row) => row.sourceRetrievedAt <= cutoff),
      };
    },

    async list(authUserId, tripId, context = {}) {
      const cutoff = cutoffAt(context.now ?? new Date(), context.maxImpactAgeMs);
      const rows = await db
        .select({ recommendation: disruptionRecommendations })
        .from(disruptionRecommendations)
        .innerJoin(users, eq(disruptionRecommendations.ownerUserId, users.id))
        .innerJoin(
          liveConditionImpacts,
          eq(disruptionRecommendations.liveConditionImpactId, liveConditionImpacts.id),
        )
        .where(
          and(
            eq(users.authUserId, authUserId),
            eq(disruptionRecommendations.tripId, tripId),
            inArray(disruptionRecommendations.status, ["pending", "applying", "failed"]),
            eq(liveConditionImpacts.state, "active"),
            gte(liveConditionImpacts.confidence, MINIMUM_RECOMMENDATION_CONFIDENCE),
            gt(liveConditionImpacts.sourceRetrievedAt, cutoff),
          ),
        )
        .orderBy(desc(disruptionRecommendations.createdAt), asc(disruptionRecommendations.id))
        .limit(10);
      return rows.map(({ recommendation }) => serializeRecommendation(recommendation));
    },

    async create(authUserId, rawSnapshot, context = {}) {
      const snapshot = disruptionRecommendationSnapshotSchema.parse(rawSnapshot);
      const now = context.now ?? new Date();
      const cutoff = cutoffAt(now, context.maxImpactAgeMs);
      return db.transaction(async (transaction) => {
        const [eligible] = await transaction
          .select({
            impactId: liveConditionImpacts.id,
            itemId: itineraryItems.id,
            originalPlaceId: liveConditionImpacts.placeId,
            ownerUserId: users.id,
          })
          .from(liveConditionImpacts)
          .innerJoin(trips, eq(liveConditionImpacts.tripId, trips.id))
          .innerJoin(users, eq(trips.ownerUserId, users.id))
          .innerJoin(itineraryItems, eq(liveConditionImpacts.itineraryItemId, itineraryItems.id))
          .where(
            and(
              eq(users.authUserId, authUserId),
              eq(trips.id, snapshot.tripId),
              eq(trips.status, "active"),
              eq(liveConditionImpacts.id, snapshot.impact.impactId),
              eq(liveConditionImpacts.state, "active"),
              eq(itineraryItems.placeId, liveConditionImpacts.placeId),
              gte(liveConditionImpacts.confidence, MINIMUM_RECOMMENDATION_CONFIDENCE),
              gt(liveConditionImpacts.sourceRetrievedAt, cutoff),
            ),
          )
          .limit(1);
        if (!eligible) throw new DisruptionRecommendationConflictError();
        if (
          eligible.itemId !== snapshot.original.itemId ||
          eligible.originalPlaceId !== snapshot.original.placeId
        ) {
          throw new DisruptionRecommendationConflictError(
            "The affected itinerary item changed before the alternative could be saved.",
          );
        }
        const [alternative] = await transaction
          .select({ id: places.id })
          .from(places)
          .where(and(eq(places.id, snapshot.alternative.placeId), eq(places.status, "active")))
          .limit(1);
        if (!alternative) throw new DisruptionRecommendationConflictError();
        const [created] = await transaction
          .insert(disruptionRecommendations)
          .values({
            alternativePlaceId: snapshot.alternative.placeId,
            createdAt: now,
            itineraryItemId: snapshot.original.itemId,
            liveConditionImpactId: snapshot.impact.impactId,
            originalPlaceId: snapshot.original.placeId,
            ownerUserId: eligible.ownerUserId,
            snapshot,
            tripId: snapshot.tripId,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: disruptionRecommendations.liveConditionImpactId })
          .returning();
        return created ? serializeRecommendation(created) : null;
      });
    },

    async decide(authUserId, tripId, recommendationId, decision, context = {}) {
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const [row] = await transaction
          .select({ recommendation: disruptionRecommendations })
          .from(disruptionRecommendations)
          .innerJoin(users, eq(disruptionRecommendations.ownerUserId, users.id))
          .where(
            and(
              eq(disruptionRecommendations.id, recommendationId),
              eq(disruptionRecommendations.tripId, tripId),
              eq(users.authUserId, authUserId),
            ),
          )
          .for("update")
          .limit(1);
        if (!row) throw new AuthorizedResourceNotFoundError();
        if (row.recommendation.status !== "pending" && row.recommendation.status !== "failed") {
          throw new DisruptionRecommendationConflictError();
        }
        const status = decision === "keep" ? "kept" : "dismissed";
        await transaction
          .update(disruptionRecommendations)
          .set({ decidedAt: now, failureCode: null, status, updatedAt: now })
          .where(eq(disruptionRecommendations.id, recommendationId));
        return { recommendationId, status, tripId };
      });
    },

    async beginApply(authUserId, tripId, recommendationId, context = {}) {
      const now = context.now ?? new Date();
      const cutoff = cutoffAt(now, context.maxImpactAgeMs);
      return db.transaction(async (transaction) => {
        const [row] = await transaction
          .select({
            impactState: liveConditionImpacts.state,
            itemPlaceId: itineraryItems.placeId,
            recommendation: disruptionRecommendations,
            sourceRetrievedAt: liveConditionImpacts.sourceRetrievedAt,
          })
          .from(disruptionRecommendations)
          .innerJoin(users, eq(disruptionRecommendations.ownerUserId, users.id))
          .innerJoin(
            liveConditionImpacts,
            eq(disruptionRecommendations.liveConditionImpactId, liveConditionImpacts.id),
          )
          .innerJoin(
            itineraryItems,
            eq(disruptionRecommendations.itineraryItemId, itineraryItems.id),
          )
          .where(
            and(
              eq(disruptionRecommendations.id, recommendationId),
              eq(disruptionRecommendations.tripId, tripId),
              eq(users.authUserId, authUserId),
            ),
          )
          .for("update")
          .limit(1);
        if (!row) throw new AuthorizedResourceNotFoundError();
        if (
          row.recommendation.status !== "pending" ||
          row.impactState !== "active" ||
          row.sourceRetrievedAt <= cutoff ||
          row.itemPlaceId !== row.recommendation.originalPlaceId
        ) {
          throw new DisruptionRecommendationConflictError(
            "The trip or live condition changed. Refresh before reviewing another alternative.",
          );
        }
        await transaction
          .update(disruptionRecommendations)
          .set({ status: "applying", updatedAt: now })
          .where(eq(disruptionRecommendations.id, recommendationId));
        return disruptionRecommendationSnapshotSchema.parse(row.recommendation.snapshot);
      });
    },

    async finishApply(recommendationId, outcome, context = {}) {
      const now = context.now ?? new Date();
      const failureCode =
        outcome.status === "failed" ? (outcome.failureCode ?? "apply_failed") : null;
      const [updated] = await db
        .update(disruptionRecommendations)
        .set({
          actionId: outcome.actionId,
          decidedAt: now,
          failureCode,
          status: outcome.status,
          updatedAt: now,
        })
        .where(
          and(
            eq(disruptionRecommendations.id, recommendationId),
            eq(disruptionRecommendations.status, "applying"),
          ),
        )
        .returning({ id: disruptionRecommendations.id });
      if (!updated) throw new DisruptionRecommendationConflictError();
    },
  };
}
