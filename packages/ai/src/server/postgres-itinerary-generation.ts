import { randomUUID } from "node:crypto";

import {
  AuthorizedResourceNotFoundError,
  TripConcurrencyError,
  itineraryDays,
  itineraryGenerationAttempts,
  itineraryGenerationRuns,
  itineraryItems,
  places,
  travelProfiles,
  tripDestinations,
  trips,
  users,
  type Database,
} from "@roavia/db";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { groundingContextSchema, type GroundingContext } from "../grounding.js";
import {
  normalizeItineraryGenerationRequest,
  type ItineraryGenerationAttemptAudit,
  type ItineraryGenerationSuccess,
  type NormalizedItineraryGenerationRequest,
} from "../itinerary-generation.js";
import type {
  ItineraryGenerationRunFailure,
  ItineraryGenerationRunSnapshot,
  ItineraryGenerationRunStage,
  ItineraryGenerationStore,
} from "../itinerary-generation-service.js";
import { itineraryOutputV1Schema, type ItineraryOutputV1 } from "../schemas.js";

const createRunInputSchema = z
  .object({
    authUserId: z.string().min(1).max(500),
    correlationId: z.uuid(),
    expectedTripRevision: z.number().int().positive(),
    maxRepairAttempts: z.number().int().min(0).max(3).default(2),
    promptVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
    tripId: z.uuid(),
  })
  .strict();

export type CreateItineraryGenerationRunInput = z.input<typeof createRunInputSchema>;

export interface CreatedItineraryGenerationRun {
  correlationId: string;
  maxRepairAttempts: number;
  runId: string;
  status: "queued";
  tripId: string;
  tripRevision: number;
}

export interface ItineraryGenerationRunRecord {
  assumptions: ItineraryOutputV1["assumptions"];
  attempts: Array<{
    attemptNumber: number;
    issueCodes: string[];
    kind: "initial" | "repair";
    outcome: "accepted" | "provider_error" | "rejected";
    repairNumber: number | null;
  }>;
  completedAt: string | null;
  createdAt: string;
  failureCode: string | null;
  groundingStatus: GroundingContext["status"] | null;
  id: string;
  maxRepairAttempts: number;
  overallConfidence: number | null;
  repairAttempts: number;
  sources: ItineraryOutputV1["sources"];
  status: typeof itineraryGenerationRuns.$inferSelect.status;
  tripId: string;
  tripRevision: number;
  warnings: ItineraryOutputV1["warnings"];
}

export class ItineraryGenerationRunStateError extends Error {
  readonly code = "generation_state_conflict" as const;

  constructor(message = "The itinerary generation run is no longer executable.") {
    super(message);
    this.name = "ItineraryGenerationRunStateError";
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function preferenceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}

function nextUpdateTime(previous: Date, candidate: Date): Date {
  return new Date(Math.max(candidate.getTime(), previous.getTime() + 1));
}

function confidenceValue(
  level: ItineraryOutputV1["days"][number]["items"][number]["confidence"]["level"],
): number {
  return { high: 0.9, low: 0.35, medium: 0.65, unknown: 0.15 }[level];
}

function currencyMinorScale(currency: string): number {
  if (["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"].includes(currency)) return 1_000;
  if (
    [
      "BIF",
      "CLP",
      "DJF",
      "GNF",
      "ISK",
      "JPY",
      "KMF",
      "KRW",
      "PYG",
      "RWF",
      "UGX",
      "UYI",
      "VND",
      "VUV",
      "XAF",
      "XOF",
      "XPF",
    ].includes(currency)
  )
    return 1;
  return 100;
}

function itemType(
  value: ItineraryOutputV1["days"][number]["items"][number]["itemType"],
): typeof itineraryItems.$inferInsert.itemType {
  return {
    accommodation: "lodging",
    activity: "activity",
    break: "note",
    meal: "food",
    other: "note",
    transport: "transport",
  }[value] as typeof itineraryItems.$inferInsert.itemType;
}

function summaryFromRows(
  run: typeof itineraryGenerationRuns.$inferSelect,
  attempts: Array<typeof itineraryGenerationAttempts.$inferSelect>,
): ItineraryGenerationRunRecord {
  return {
    assumptions: run.assumptions as ItineraryOutputV1["assumptions"],
    attempts: attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      issueCodes: stringList(attempt.issueCodes),
      kind: attempt.kind,
      outcome: attempt.outcome,
      repairNumber: attempt.repairNumber,
    })),
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    failureCode: run.failureCode,
    groundingStatus: run.groundingStatus,
    id: run.id,
    maxRepairAttempts: run.maxRepairAttempts,
    overallConfidence: run.overallConfidence,
    repairAttempts: run.repairAttempts,
    sources: run.sources as ItineraryOutputV1["sources"],
    status: run.status,
    tripId: run.tripId,
    tripRevision: run.tripRevision,
    warnings: run.warnings as ItineraryOutputV1["warnings"],
  };
}

/** PostgreSQL run/audit store. It never persists prompts or unvalidated provider output. */
export class PostgresItineraryGenerationStore implements ItineraryGenerationStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async createRun(
    rawInput: CreateItineraryGenerationRunInput,
  ): Promise<CreatedItineraryGenerationRun> {
    const input = createRunInputSchema.parse(rawInput);
    const now = new Date();
    try {
      return await this.db.transaction(async (transaction) => {
        const [ownedTrip] = await transaction
          .select({ actorUserId: users.id, trip: trips })
          .from(trips)
          .innerJoin(users, eq(trips.ownerUserId, users.id))
          .where(and(eq(trips.id, input.tripId), eq(users.authUserId, input.authUserId)))
          .limit(1)
          .for("update");
        if (!ownedTrip) throw new AuthorizedResourceNotFoundError();
        if (ownedTrip.trip.revision !== input.expectedTripRevision) {
          throw new TripConcurrencyError();
        }
        const [destinationCount] = await transaction
          .select({ value: count() })
          .from(tripDestinations)
          .where(eq(tripDestinations.tripId, input.tripId));
        if (!destinationCount?.value) {
          throw new ItineraryGenerationRunStateError(
            "At least one resolved destination is required before generation.",
          );
        }

        const tripRevision = ownedTrip.trip.revision + 1;
        await transaction
          .update(trips)
          .set({
            generationState: "queued",
            revision: tripRevision,
            updatedAt: nextUpdateTime(ownedTrip.trip.updatedAt, now),
          })
          .where(eq(trips.id, input.tripId));
        const [run] = await transaction
          .insert(itineraryGenerationRuns)
          .values({
            correlationId: input.correlationId,
            createdAt: now,
            maxRepairAttempts: input.maxRepairAttempts,
            promptVersion: input.promptVersion,
            requestedByUserId: ownedTrip.actorUserId,
            tripId: input.tripId,
            tripRevision,
            updatedAt: now,
          })
          .returning();
        if (!run) throw new Error("Itinerary generation run could not be created.");
        return {
          correlationId: run.correlationId,
          maxRepairAttempts: run.maxRepairAttempts,
          runId: run.id,
          status: "queued",
          tripId: run.tripId,
          tripRevision: run.tripRevision,
        };
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new TripConcurrencyError();
      }
      throw error;
    }
  }

  async begin(
    runId: string,
    expected: { tripId: string; tripRevision: number },
  ): Promise<ItineraryGenerationRunSnapshot> {
    const parsedRunId = z.uuid().parse(runId);
    const expectedTripId = z.uuid().parse(expected.tripId);
    const expectedTripRevision = z.number().int().positive().parse(expected.tripRevision);
    const snapshot = await this.db.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(itineraryGenerationRuns)
        .where(eq(itineraryGenerationRuns.id, parsedRunId))
        .limit(1)
        .for("update");
      if (!run) throw new ItineraryGenerationRunStateError("The generation run was not found.");
      if (run.tripId !== expectedTripId || run.tripRevision !== expectedTripRevision) {
        throw new ItineraryGenerationRunStateError(
          "The generation job does not match its persisted trip revision.",
        );
      }
      if (["succeeded", "failed", "cancelled"].includes(run.status)) {
        throw new ItineraryGenerationRunStateError();
      }

      const [tripOwner] = await transaction
        .select({ trip: trips, user: users })
        .from(trips)
        .innerJoin(users, eq(trips.ownerUserId, users.id))
        .where(eq(trips.id, run.tripId))
        .limit(1)
        .for("update");
      if (!tripOwner)
        throw new ItineraryGenerationRunStateError("The generation trip was deleted.");
      if (tripOwner.trip.revision !== run.tripRevision) {
        const completedAt = new Date();
        await transaction
          .update(itineraryGenerationRuns)
          .set({
            completedAt,
            failureCode: "stale_trip_revision",
            status: "failed",
            updatedAt: completedAt,
          })
          .where(eq(itineraryGenerationRuns.id, run.id));
        await transaction
          .update(trips)
          .set({ generationState: "failed" })
          .where(eq(trips.id, run.tripId));
        return null;
      }

      const destinations = await transaction
        .select({
          name: places.canonicalName,
          placeId: places.id,
          timezone: places.timezone,
        })
        .from(tripDestinations)
        .innerJoin(places, eq(tripDestinations.placeId, places.id))
        .where(eq(tripDestinations.tripId, run.tripId))
        .orderBy(asc(tripDestinations.orderIndex));
      if (destinations.length === 0) {
        throw new ItineraryGenerationRunStateError(
          "The generation trip has no resolved destinations.",
        );
      }

      const [profile] = await transaction
        .select()
        .from(travelProfiles)
        .where(eq(travelProfiles.userId, tripOwner.user.id))
        .limit(1);
      const preferences = preferenceObject(profile?.travelPreferences);
      const pace = profile?.defaultPace ?? "balanced";
      const fallbackTransfers = pace === "slow" ? 3 : pace === "fast" ? 6 : 4;
      const fallbackMinutes = pace === "slow" ? 75 : pace === "fast" ? 180 : 120;
      const request: NormalizedItineraryGenerationRequest = normalizeItineraryGenerationRequest({
        accessibilityNeeds: stringList(profile?.accessibilityNeeds),
        budget: tripOwner.trip.budget,
        destinations: destinations.map((destination) => ({
          ...destination,
          timezone: destination.timezone ?? tripOwner.user.timezone,
        })),
        dietaryNeeds: stringList(profile?.dietaryNeeds),
        endDate: tripOwner.trip.endDate,
        interests: stringList(profile?.interests),
        locale: tripOwner.user.locale,
        maxTransferMinutes: boundedInteger(
          preferences.maxTransferMinutes,
          fallbackMinutes,
          15,
          720,
        ),
        maxTransfersPerDay: boundedInteger(
          preferences.maxTransfersPerDay,
          fallbackTransfers,
          0,
          20,
        ),
        mustAvoid: stringList(preferences.mustAvoid),
        mustDo: stringList(preferences.mustDo),
        pace,
        startDate: tripOwner.trip.startDate,
        title: tripOwner.trip.title,
        travelers: tripOwner.trip.travelerSummary,
        tripId: tripOwner.trip.id,
        tripRevision: run.tripRevision,
      });
      const [attemptStats] = await transaction
        .select({
          attempts: count(),
          repairs: sql<number>`count(*) filter (where ${itineraryGenerationAttempts.kind} = 'repair')`,
        })
        .from(itineraryGenerationAttempts)
        .where(eq(itineraryGenerationAttempts.generationRunId, run.id));
      const startedAt = run.startedAt ?? new Date();
      await transaction
        .update(itineraryGenerationRuns)
        .set({ startedAt, status: "retrieving", updatedAt: startedAt })
        .where(eq(itineraryGenerationRuns.id, run.id));
      await transaction
        .update(trips)
        .set({ generationState: "generating" })
        .where(eq(trips.id, run.tripId));

      return {
        attemptCount: attemptStats?.attempts ?? 0,
        maxRepairAttempts: run.maxRepairAttempts,
        promptVersion: run.promptVersion,
        repairAttempts: attemptStats?.repairs ?? 0,
        request,
        runId: run.id,
        tripId: run.tripId,
        tripRevision: run.tripRevision,
      };
    });
    if (!snapshot) {
      throw new ItineraryGenerationRunStateError(
        "The trip changed after generation was requested.",
      );
    }
    return snapshot;
  }

  async recordGrounding(runId: string, rawContext: GroundingContext): Promise<void> {
    const context = groundingContextSchema.parse(rawContext);
    await this.db
      .update(itineraryGenerationRuns)
      .set({
        groundingSchemaVersion: context.schemaVersion,
        groundingStatus: context.status,
        updatedAt: new Date(),
      })
      .where(eq(itineraryGenerationRuns.id, z.uuid().parse(runId)));
  }

  async setStage(
    runId: string,
    stage: Exclude<ItineraryGenerationRunStage, "queued" | "retrieving">,
  ): Promise<void> {
    await this.db
      .update(itineraryGenerationRuns)
      .set({ status: stage, updatedAt: new Date() })
      .where(
        and(
          eq(itineraryGenerationRuns.id, z.uuid().parse(runId)),
          inArray(itineraryGenerationRuns.status, [
            "retrieving",
            "generating",
            "validating",
            "repairing",
            "persisting",
          ]),
        ),
      );
  }

  async recordAttempt(runId: string, attempt: ItineraryGenerationAttemptAudit): Promise<void> {
    const parsedRunId = z.uuid().parse(runId);
    await this.db.transaction(async (transaction) => {
      await transaction
        .insert(itineraryGenerationAttempts)
        .values({
          attemptNumber: attempt.attemptNumber,
          costAmountMicros: attempt.cost?.amountMicros,
          costCurrency: attempt.cost?.currency,
          durationMs: attempt.durationMs,
          generationRunId: parsedRunId,
          inputTokens: attempt.usage?.inputTokens,
          issueCodes: attempt.issueCodes,
          kind: attempt.kind,
          model: attempt.model,
          outcome: attempt.outcome,
          outputTokens: attempt.usage?.outputTokens,
          promptVersion: attempt.promptVersion,
          provider: attempt.provider,
          repairNumber: attempt.repairNumber,
          totalTokens: attempt.usage?.totalTokens,
        })
        .onConflictDoNothing({
          target: [
            itineraryGenerationAttempts.generationRunId,
            itineraryGenerationAttempts.attemptNumber,
          ],
        });
      if (attempt.repairNumber !== null) {
        await transaction
          .update(itineraryGenerationRuns)
          .set({
            repairAttempts: sql`greatest(${itineraryGenerationRuns.repairAttempts}, ${attempt.repairNumber})`,
            updatedAt: new Date(),
          })
          .where(eq(itineraryGenerationRuns.id, parsedRunId));
      }
    });
  }

  async finishFailure(runId: string, failure: ItineraryGenerationRunFailure): Promise<void> {
    const parsedRunId = z.uuid().parse(runId);
    const now = new Date();
    await this.db.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(itineraryGenerationRuns)
        .where(eq(itineraryGenerationRuns.id, parsedRunId))
        .limit(1)
        .for("update");
      if (!run || run.status === "succeeded") return;
      const terminal = failure.cancelled || failure.terminal;
      const status = failure.cancelled ? "cancelled" : terminal ? "failed" : "queued";
      await transaction
        .update(itineraryGenerationRuns)
        .set({
          completedAt: terminal ? now : null,
          failureCode: failure.code,
          status,
          updatedAt: now,
        })
        .where(eq(itineraryGenerationRuns.id, run.id));
      await transaction
        .update(trips)
        .set({
          generationState: failure.cancelled ? "idle" : terminal ? "failed" : "queued",
        })
        .where(and(eq(trips.id, run.tripId), eq(trips.revision, run.tripRevision)));
    });
  }

  async persistSuccess(
    runSnapshot: ItineraryGenerationRunSnapshot,
    result: ItineraryGenerationSuccess,
    rawGroundingContext: GroundingContext,
  ): Promise<void> {
    const draft = itineraryOutputV1Schema.parse(result.draft);
    const groundingContext = groundingContextSchema.parse(rawGroundingContext);
    if (!result.validation.valid || result.validation.blockingIssues.length > 0) {
      throw new ItineraryGenerationRunStateError(
        "Only a fully validated itinerary draft can be persisted.",
      );
    }

    const sourceById = new Map(groundingContext.sources.map((source) => [source.sourceId, source]));
    const candidatePlaceIds = [
      ...new Set(
        draft.days.flatMap((day) =>
          day.items.flatMap((item) => (item.place?.placeId ? [item.place.placeId] : [])),
        ),
      ),
    ];
    if (candidatePlaceIds.some((placeId) => !z.uuid().safeParse(placeId).success)) {
      throw new ItineraryGenerationRunStateError(
        "A validated itinerary place does not use a persistent place identifier.",
      );
    }

    await this.db.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(itineraryGenerationRuns)
        .where(eq(itineraryGenerationRuns.id, runSnapshot.runId))
        .limit(1)
        .for("update");
      if (!run) throw new ItineraryGenerationRunStateError("The generation run was not found.");
      if (run.status === "succeeded") return;
      if (run.status !== "persisting") throw new ItineraryGenerationRunStateError();

      const [trip] = await transaction
        .select()
        .from(trips)
        .where(eq(trips.id, run.tripId))
        .limit(1)
        .for("update");
      if (
        !trip ||
        trip.revision !== run.tripRevision ||
        trip.revision !== runSnapshot.tripRevision
      ) {
        throw new ItineraryGenerationRunStateError(
          "The trip changed before the validated draft could be persisted.",
        );
      }

      if (candidatePlaceIds.length > 0) {
        const persistedPlaces = await transaction
          .select({ id: places.id })
          .from(places)
          .where(and(inArray(places.id, candidatePlaceIds), eq(places.status, "active")));
        if (persistedPlaces.length !== candidatePlaceIds.length) {
          throw new ItineraryGenerationRunStateError(
            "A validated itinerary references a place that is no longer available.",
          );
        }
      }

      await transaction.delete(itineraryDays).where(eq(itineraryDays.tripId, trip.id));
      const dayRows = draft.days.map((day, orderIndex) => ({
        id: randomUUID(),
        localDate: day.localDate,
        notes: day.notes,
        orderIndex,
        timezone: day.timezone,
        title: day.title.slice(0, 200),
        tripId: trip.id,
      }));
      if (dayRows.length > 0) await transaction.insert(itineraryDays).values(dayRows);

      const itemRows = draft.days.flatMap((day, dayIndex) =>
        day.items.map((item, orderIndex) => {
          const estimatedCost = item.estimatedCost
            ? {
                amountMinor: Math.round(
                  item.estimatedCost.minimumAmount *
                    currencyMinorScale(item.estimatedCost.currencyCode),
                ),
                currency: item.estimatedCost.currencyCode,
              }
            : {};
          const citedSources = item.sourceIds.map((sourceId) => sourceById.get(sourceId)!);
          return {
            booking: item.booking ?? {},
            confidence: confidenceValue(item.confidence.level),
            durationMinutes: item.durationMinutes,
            endTime: item.endTime,
            estimatedCost,
            itineraryDayId: dayRows[dayIndex]!.id,
            itemType: itemType(item.itemType),
            notes: item.notes ? `${item.title}\n${item.notes}` : item.title,
            orderIndex,
            placeId: item.place?.placeId ?? null,
            sourceSnapshot: {
              candidateId: item.candidateId,
              confidence: item.confidence,
              costRange: item.estimatedCost,
              place: item.place,
              sources: citedSources,
              title: item.title,
            },
            startTime: item.startTime,
            transport:
              item.itemType === "transport" ? { durationMinutes: item.durationMinutes } : {},
          };
        }),
      );
      if (itemRows.length > 0) await transaction.insert(itineraryItems).values(itemRows);

      const completedAt = new Date();
      await transaction
        .update(itineraryGenerationRuns)
        .set({
          assumptions: draft.assumptions,
          completedAt,
          failureCode: null,
          groundingSchemaVersion: groundingContext.schemaVersion,
          groundingStatus: groundingContext.status,
          overallConfidence: result.overallConfidence,
          repairAttempts: result.repairAttempts,
          sources: draft.sources,
          status: "succeeded",
          updatedAt: completedAt,
          warnings: draft.warnings,
        })
        .where(eq(itineraryGenerationRuns.id, run.id));
      await transaction
        .update(trips)
        .set({
          generationState: "ready",
          revision: trip.revision + 1,
          updatedAt: nextUpdateTime(trip.updatedAt, completedAt),
        })
        .where(eq(trips.id, trip.id));
    });
  }

  async getLatestRun(
    authUserId: string,
    tripId: string,
  ): Promise<ItineraryGenerationRunRecord | null> {
    const [ownedRun] = await this.db
      .select({ run: itineraryGenerationRuns })
      .from(itineraryGenerationRuns)
      .innerJoin(trips, eq(itineraryGenerationRuns.tripId, trips.id))
      .innerJoin(users, eq(trips.ownerUserId, users.id))
      .where(and(eq(trips.id, z.uuid().parse(tripId)), eq(users.authUserId, authUserId)))
      .orderBy(sql`${itineraryGenerationRuns.createdAt} desc`)
      .limit(1);
    if (!ownedRun) return null;
    const attempts = await this.db
      .select()
      .from(itineraryGenerationAttempts)
      .where(eq(itineraryGenerationAttempts.generationRunId, ownedRun.run.id))
      .orderBy(asc(itineraryGenerationAttempts.attemptNumber));
    return summaryFromRows(ownedRun.run, attempts);
  }
}
