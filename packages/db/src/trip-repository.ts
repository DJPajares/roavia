import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import {
  tripChildDeleteInputSchema,
  tripCreateInputSchema,
  tripDayCreateInputSchema,
  tripDayUpdateInputSchema,
  tripDeleteInputSchema,
  tripDestinationCreateInputSchema,
  tripDestinationUpdateInputSchema,
  tripItemCreateInputSchema,
  tripItemUpdateInputSchema,
  tripListQuerySchema,
  tripMoneySchema,
  tripUpdateInputSchema,
  itineraryGenerationSummarySchema,
  type Trip,
  type TripChildDeleteInput,
  type TripCreateInput,
  type TripDay,
  type TripDayCreateInput,
  type TripDayUpdateInput,
  type TripDeleteInput,
  type TripDestination,
  type TripDestinationCreateInput,
  type TripDestinationUpdateInput,
  type TripDetail,
  type TripItem,
  type TripItemCreateInput,
  type TripItemUpdateInput,
  type ItineraryGenerationSummary,
  type TripListData,
  type TripListQuery,
  type TripUpdateInput,
} from "@roavia/contracts";
import { and, asc, count, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { AuthorizedResourceNotFoundError } from "./authorization.js";
import type { Database } from "./client.js";
import {
  auditEvents,
  itineraryDays,
  itineraryGenerationRuns,
  itineraryItems,
  places,
  tripDestinations,
  trips,
  users,
} from "./schema.js";

type DatabaseExecutor = Pick<Database, "delete" | "execute" | "insert" | "select" | "update">;
type TripRow = typeof trips.$inferSelect;
type TripDestinationRow = typeof tripDestinations.$inferSelect;
type TripDayRow = typeof itineraryDays.$inferSelect;
type TripItemRow = typeof itineraryItems.$inferSelect;
type ItineraryGenerationRunRow = typeof itineraryGenerationRuns.$inferSelect;

const ORDER_OFFSET = 100_000;
const MOVED_ORDER_INDEX = 200_000;
const tripCursorSchema = z.object({ id: z.string().uuid(), updatedAt: z.string().datetime() });

export interface TripMutationContext {
  correlationId?: string;
  now?: Date;
}

export interface TripRepository {
  listTrips(authUserId: string, query: TripListQuery): Promise<TripListData>;
  createTrip(
    authUserId: string,
    input: TripCreateInput,
    context?: TripMutationContext,
  ): Promise<TripDetail>;
  getTrip(authUserId: string, tripId: string): Promise<TripDetail>;
  updateTrip(
    authUserId: string,
    tripId: string,
    input: TripUpdateInput,
    context?: TripMutationContext,
  ): Promise<TripDetail>;
  deleteTrip(
    authUserId: string,
    tripId: string,
    input: TripDeleteInput,
    context?: TripMutationContext,
  ): Promise<{ deletedId: string }>;
  createDestination(
    authUserId: string,
    tripId: string,
    input: TripDestinationCreateInput,
    context?: TripMutationContext,
  ): Promise<{ destination: TripDestination; tripRevision: number }>;
  updateDestination(
    authUserId: string,
    tripId: string,
    destinationId: string,
    input: TripDestinationUpdateInput,
    context?: TripMutationContext,
  ): Promise<{ destination: TripDestination; tripRevision: number }>;
  deleteDestination(
    authUserId: string,
    tripId: string,
    destinationId: string,
    input: TripChildDeleteInput,
    context?: TripMutationContext,
  ): Promise<{ deletedId: string; tripRevision: number }>;
  createDay(
    authUserId: string,
    tripId: string,
    input: TripDayCreateInput,
    context?: TripMutationContext,
  ): Promise<{ day: TripDay; tripRevision: number }>;
  updateDay(
    authUserId: string,
    tripId: string,
    dayId: string,
    input: TripDayUpdateInput,
    context?: TripMutationContext,
  ): Promise<{ day: TripDay; tripRevision: number }>;
  deleteDay(
    authUserId: string,
    tripId: string,
    dayId: string,
    input: TripChildDeleteInput,
    context?: TripMutationContext,
  ): Promise<{ deletedId: string; tripRevision: number }>;
  createItem(
    authUserId: string,
    tripId: string,
    input: TripItemCreateInput,
    context?: TripMutationContext,
  ): Promise<{ item: TripItem; tripRevision: number }>;
  updateItem(
    authUserId: string,
    tripId: string,
    itemId: string,
    input: TripItemUpdateInput,
    context?: TripMutationContext,
  ): Promise<{ item: TripItem; tripRevision: number }>;
  deleteItem(
    authUserId: string,
    tripId: string,
    itemId: string,
    input: TripChildDeleteInput,
    context?: TripMutationContext,
  ): Promise<{ deletedId: string; tripRevision: number }>;
}

export class TripConcurrencyError extends Error {
  readonly code = "conflict" as const;

  constructor() {
    super("The trip changed since it was loaded. Refresh and try again.");
    this.name = "TripConcurrencyError";
  }
}

export class TripDomainInputError extends Error {
  readonly code = "bad_request" as const;

  constructor(message = "The trip change is invalid.") {
    super(message);
    this.name = "TripDomainInputError";
  }
}

function slugForTitle(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return `${base || "trip"}-${randomUUID().slice(0, 8)}`;
}

function nextUpdateTime(previous: Date, candidate: Date): Date {
  return new Date(Math.max(candidate.getTime(), previous.getTime() + 1));
}

function auditExpiry(occurredAt: Date): Date {
  const expiresAt = new Date(occurredAt);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  return expiresAt;
}

function serializeTrip(row: TripRow): Trip {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    originPlaceId: row.originPlaceId,
    startDate: row.startDate,
    endDate: row.endDate,
    dateFlexibility: row.dateFlexibility as Trip["dateFlexibility"],
    travelerSummary: row.travelerSummary as Trip["travelerSummary"],
    budget: row.budget as Trip["budget"],
    planningPreferences: row.planningPreferences as Trip["planningPreferences"],
    status: row.status,
    visibility: row.visibility,
    generationState: row.generationState,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeDestination(row: TripDestinationRow): TripDestination {
  return {
    id: row.id,
    tripId: row.tripId,
    placeId: row.placeId,
    arrivalAt: row.arrivalAt?.toISOString() ?? null,
    departureAt: row.departureAt?.toISOString() ?? null,
    orderIndex: row.orderIndex,
  };
}

function serializeItem(row: TripItemRow): TripItem {
  const estimatedCost =
    Object.keys(row.estimatedCost).length === 0 ? null : tripMoneySchema.parse(row.estimatedCost);
  return {
    id: row.id,
    itineraryDayId: row.itineraryDayId,
    placeId: row.placeId,
    itemType: row.itemType,
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    estimatedCost,
    transport: row.transport,
    booking: row.booking,
    sourceSnapshot: row.sourceSnapshot,
    confidence: row.confidence,
    notes: row.notes,
    orderIndex: row.orderIndex,
  };
}

function serializeDay(row: TripDayRow, items: TripItem[] = []): TripDay {
  return {
    id: row.id,
    tripId: row.tripId,
    localDate: row.localDate,
    timezone: row.timezone,
    title: row.title,
    notes: row.notes,
    orderIndex: row.orderIndex,
    items,
  };
}

function serializeGenerationRun(row: ItineraryGenerationRunRow): ItineraryGenerationSummary {
  return itineraryGenerationSummarySchema.parse({
    assumptions: row.assumptions,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    failureCode: row.failureCode,
    groundingStatus: row.groundingStatus,
    id: row.id,
    maxRepairAttempts: row.maxRepairAttempts,
    overallConfidence: row.overallConfidence,
    repairAttempts: row.repairAttempts,
    sources: row.sources,
    status: row.status,
    tripRevision: row.tripRevision,
    warnings: row.warnings,
  });
}

function encodeCursor(row: TripRow): string {
  return Buffer.from(
    JSON.stringify({ id: row.id, updatedAt: row.updatedAt.toISOString() }),
  ).toString("base64url");
}

function decodeCursor(cursor: string) {
  try {
    return tripCursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new TripDomainInputError("The trip-list cursor is invalid.");
  }
}

async function selectOwnedTrip(executor: DatabaseExecutor, authUserId: string, tripId: string) {
  const [ownedTrip] = await executor
    .select({ actorUserId: users.id, trip: trips })
    .from(trips)
    .innerJoin(users, eq(trips.ownerUserId, users.id))
    .where(and(eq(trips.id, tripId), eq(users.authUserId, authUserId)))
    .limit(1);
  return ownedTrip ?? null;
}

async function lockOwnedTrip(executor: DatabaseExecutor, authUserId: string, tripId: string) {
  const [ownedTrip] = await executor
    .select({ actorUserId: users.id, trip: trips })
    .from(trips)
    .innerJoin(users, eq(trips.ownerUserId, users.id))
    .where(and(eq(trips.id, tripId), eq(users.authUserId, authUserId)))
    .limit(1)
    .for("update");
  if (!ownedTrip) {
    throw new AuthorizedResourceNotFoundError();
  }
  return ownedTrip;
}

function assertRevision(actual: number, expected: number) {
  if (actual !== expected) {
    throw new TripConcurrencyError();
  }
}

async function requirePlace(executor: DatabaseExecutor, placeId: string) {
  const [place] = await executor
    .select({ id: places.id })
    .from(places)
    .where(and(eq(places.id, placeId), eq(places.status, "active")))
    .limit(1);
  if (!place) {
    throw new TripDomainInputError("The selected place is unavailable.");
  }
}

function assertDateWithinTrip(trip: TripRow, localDate: string) {
  if (localDate < trip.startDate || localDate > trip.endDate) {
    throw new TripDomainInputError("Itinerary days must fall within the trip dates.");
  }
}

function assertTimePair(startTime: string | null, endTime: string | null) {
  if (
    (startTime === null) !== (endTime === null) ||
    (startTime && endTime && endTime <= startTime)
  ) {
    throw new TripDomainInputError("Item start and end times are invalid.");
  }
}

function assertOrderIndex(orderIndex: number, itemCount: number, allowAppend: boolean) {
  const maximum = allowAppend ? itemCount : itemCount - 1;
  if (orderIndex < 0 || orderIndex > maximum) {
    throw new TripDomainInputError("The requested order position is invalid.");
  }
}

async function collectionCount(
  executor: DatabaseExecutor,
  table: typeof tripDestinations | typeof itineraryDays | typeof itineraryItems,
  condition: ReturnType<typeof eq>,
): Promise<number> {
  const [result] = await executor.select({ value: count() }).from(table).where(condition);
  return result?.value ?? 0;
}

async function shiftForInsert(
  executor: DatabaseExecutor,
  tableName: string,
  parentColumn: string,
  parentId: string,
  orderIndex: number,
) {
  await executor.execute(sql`
    update ${sql.identifier(tableName)}
    set order_index = order_index + ${ORDER_OFFSET}
    where ${sql.identifier(parentColumn)} = ${parentId} and order_index >= ${orderIndex}
  `);
  await executor.execute(sql`
    update ${sql.identifier(tableName)}
    set order_index = order_index - ${ORDER_OFFSET - 1}
    where ${sql.identifier(parentColumn)} = ${parentId}
      and order_index >= ${orderIndex + ORDER_OFFSET}
  `);
}

async function closeOrderGap(
  executor: DatabaseExecutor,
  tableName: string,
  parentColumn: string,
  parentId: string,
  deletedOrderIndex: number,
) {
  await executor.execute(sql`
    update ${sql.identifier(tableName)}
    set order_index = order_index + ${ORDER_OFFSET}
    where ${sql.identifier(parentColumn)} = ${parentId} and order_index > ${deletedOrderIndex}
  `);
  await executor.execute(sql`
    update ${sql.identifier(tableName)}
    set order_index = order_index - ${ORDER_OFFSET + 1}
    where ${sql.identifier(parentColumn)} = ${parentId}
      and order_index > ${deletedOrderIndex + ORDER_OFFSET}
  `);
}

async function moveOrderedRow(
  executor: DatabaseExecutor,
  tableName: string,
  parentColumn: string,
  parentId: string,
  id: string,
  oldOrderIndex: number,
  newOrderIndex: number,
) {
  if (oldOrderIndex === newOrderIndex) {
    return;
  }

  await executor.execute(sql`
    update ${sql.identifier(tableName)} set order_index = ${MOVED_ORDER_INDEX}
    where id = ${id} and ${sql.identifier(parentColumn)} = ${parentId}
  `);
  if (newOrderIndex < oldOrderIndex) {
    await executor.execute(sql`
      update ${sql.identifier(tableName)} set order_index = order_index + ${ORDER_OFFSET}
      where ${sql.identifier(parentColumn)} = ${parentId}
        and order_index >= ${newOrderIndex} and order_index < ${oldOrderIndex}
    `);
    await executor.execute(sql`
      update ${sql.identifier(tableName)} set order_index = order_index - ${ORDER_OFFSET - 1}
      where ${sql.identifier(parentColumn)} = ${parentId}
        and order_index >= ${newOrderIndex + ORDER_OFFSET}
        and order_index < ${oldOrderIndex + ORDER_OFFSET}
    `);
  } else {
    await executor.execute(sql`
      update ${sql.identifier(tableName)} set order_index = order_index + ${ORDER_OFFSET}
      where ${sql.identifier(parentColumn)} = ${parentId}
        and order_index > ${oldOrderIndex} and order_index <= ${newOrderIndex}
    `);
    await executor.execute(sql`
      update ${sql.identifier(tableName)} set order_index = order_index - ${ORDER_OFFSET + 1}
      where ${sql.identifier(parentColumn)} = ${parentId}
        and order_index > ${oldOrderIndex + ORDER_OFFSET}
        and order_index <= ${newOrderIndex + ORDER_OFFSET}
    `);
  }
  await executor.execute(sql`
    update ${sql.identifier(tableName)} set order_index = ${newOrderIndex}
    where id = ${id} and ${sql.identifier(parentColumn)} = ${parentId}
  `);
}

async function bumpTrip(executor: DatabaseExecutor, trip: TripRow, now: Date): Promise<number> {
  const revision = trip.revision + 1;
  await executor
    .update(trips)
    .set({ revision, updatedAt: nextUpdateTime(trip.updatedAt, now) })
    .where(and(eq(trips.id, trip.id), eq(trips.revision, trip.revision)));
  return revision;
}

async function recordDeletion(
  executor: DatabaseExecutor,
  actorUserId: string,
  subjectType: "trip" | "itinerary_item",
  subjectId: string,
  context: TripMutationContext,
) {
  const occurredAt = context.now ?? new Date();
  await executor.insert(auditEvents).values({
    action: "resource_deleted",
    actorUserId,
    correlationId: context.correlationId ?? randomUUID(),
    expiresAt: auditExpiry(occurredAt),
    occurredAt,
    outcome: "succeeded",
    subjectId,
    subjectType,
  });
}

async function loadTripDetail(
  executor: DatabaseExecutor,
  authUserId: string,
  tripId: string,
): Promise<TripDetail> {
  const ownedTrip = await selectOwnedTrip(executor, authUserId, tripId);
  if (!ownedTrip) {
    throw new AuthorizedResourceNotFoundError();
  }

  const destinationRows = await executor
    .select()
    .from(tripDestinations)
    .where(eq(tripDestinations.tripId, tripId))
    .orderBy(asc(tripDestinations.orderIndex), asc(tripDestinations.id));
  const dayRows = await executor
    .select()
    .from(itineraryDays)
    .where(eq(itineraryDays.tripId, tripId))
    .orderBy(asc(itineraryDays.orderIndex), asc(itineraryDays.id));
  const itemRows = await executor
    .select({ item: itineraryItems })
    .from(itineraryItems)
    .innerJoin(itineraryDays, eq(itineraryItems.itineraryDayId, itineraryDays.id))
    .where(eq(itineraryDays.tripId, tripId))
    .orderBy(asc(itineraryDays.orderIndex), asc(itineraryItems.orderIndex), asc(itineraryItems.id));
  const [generationRun] = await executor
    .select()
    .from(itineraryGenerationRuns)
    .where(eq(itineraryGenerationRuns.tripId, tripId))
    .orderBy(desc(itineraryGenerationRuns.createdAt), desc(itineraryGenerationRuns.id))
    .limit(1);
  const itemsByDay = new Map<string, TripItem[]>();
  for (const { item } of itemRows) {
    const dayItems = itemsByDay.get(item.itineraryDayId) ?? [];
    dayItems.push(serializeItem(item));
    itemsByDay.set(item.itineraryDayId, dayItems);
  }

  return {
    ...serializeTrip(ownedTrip.trip),
    destinations: destinationRows.map(serializeDestination),
    days: dayRows.map((day) => serializeDay(day, itemsByDay.get(day.id) ?? [])),
    generation: generationRun ? serializeGenerationRun(generationRun) : null,
  };
}

export function createTripRepository(db: Database): TripRepository {
  return {
    async listTrips(authUserId, rawQuery) {
      const query = tripListQuerySchema.parse(rawQuery);
      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
      const cursorDate = cursor ? new Date(cursor.updatedAt) : undefined;
      const rows = await db
        .select({ trip: trips })
        .from(trips)
        .innerJoin(users, eq(trips.ownerUserId, users.id))
        .where(
          and(
            eq(users.authUserId, authUserId),
            query.status ? eq(trips.status, query.status) : undefined,
            cursor && cursorDate
              ? or(
                  lt(trips.updatedAt, cursorDate),
                  and(eq(trips.updatedAt, cursorDate), lt(trips.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(trips.updatedAt), desc(trips.id))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      return {
        trips: page.map(({ trip }) => serializeTrip(trip)),
        pagination: {
          limit: query.limit,
          nextCursor: hasMore && page.length > 0 ? encodeCursor(page.at(-1)!.trip) : null,
        },
      };
    },

    async createTrip(authUserId, rawInput, context = {}) {
      const input = tripCreateInputSchema.parse(rawInput);
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const [actor] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.authUserId, authUserId))
          .limit(1);
        if (!actor) {
          throw new AuthorizedResourceNotFoundError();
        }
        if (input.originPlaceId) {
          await requirePlace(transaction, input.originPlaceId);
        }
        const [trip] = await transaction
          .insert(trips)
          .values({
            budget: input.budget,
            createdAt: now,
            dateFlexibility: input.dateFlexibility,
            endDate: input.endDate,
            originPlaceId: input.originPlaceId,
            planningPreferences: input.planningPreferences,
            ownerUserId: actor.id,
            slug: slugForTitle(input.title),
            startDate: input.startDate,
            status: input.status,
            title: input.title,
            travelerSummary: input.travelerSummary,
            updatedAt: now,
            visibility: input.visibility,
          })
          .returning();
        return { ...serializeTrip(trip!), destinations: [], days: [], generation: null };
      });
    },

    getTrip(authUserId, tripId) {
      return db.transaction((transaction) => loadTripDetail(transaction, authUserId, tripId), {
        accessMode: "read only",
        isolationLevel: "repeatable read",
      });
    },

    async updateTrip(authUserId, tripId, rawInput, context = {}) {
      const input = tripUpdateInputSchema.parse(rawInput);
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const ownedTrip = await lockOwnedTrip(transaction, authUserId, tripId);
        assertRevision(ownedTrip.trip.revision, input.expectedRevision);
        const startDate = input.startDate ?? ownedTrip.trip.startDate;
        const endDate = input.endDate ?? ownedTrip.trip.endDate;
        if (endDate < startDate) {
          throw new TripDomainInputError("Trip end date cannot be before its start date.");
        }
        if (input.originPlaceId) {
          await requirePlace(transaction, input.originPlaceId);
        }
        if (input.startDate || input.endDate) {
          const [outsideDay] = await transaction
            .select({ id: itineraryDays.id })
            .from(itineraryDays)
            .where(
              and(
                eq(itineraryDays.tripId, tripId),
                or(
                  lt(itineraryDays.localDate, startDate),
                  sql`${itineraryDays.localDate} > ${endDate}`,
                ),
              ),
            )
            .limit(1);
          if (outsideDay) {
            throw new TripDomainInputError("Trip dates cannot exclude an existing itinerary day.");
          }
        }
        await transaction
          .update(trips)
          .set({
            budget: input.budget,
            dateFlexibility: input.dateFlexibility,
            endDate: input.endDate,
            originPlaceId: input.originPlaceId,
            planningPreferences: input.planningPreferences,
            revision: ownedTrip.trip.revision + 1,
            startDate: input.startDate,
            status: input.status,
            title: input.title,
            travelerSummary: input.travelerSummary,
            updatedAt: nextUpdateTime(ownedTrip.trip.updatedAt, now),
            visibility: input.visibility,
          })
          .where(eq(trips.id, tripId));
        return loadTripDetail(transaction, authUserId, tripId);
      });
    },

    async deleteTrip(authUserId, tripId, rawInput, context = {}) {
      const input = tripDeleteInputSchema.parse(rawInput);
      return db.transaction(async (transaction) => {
        const ownedTrip = await lockOwnedTrip(transaction, authUserId, tripId);
        assertRevision(ownedTrip.trip.revision, input.expectedRevision);
        await recordDeletion(transaction, ownedTrip.actorUserId, "trip", tripId, context);
        await transaction.delete(trips).where(eq(trips.id, tripId));
        return { deletedId: tripId };
      });
    },

    async createDestination(authUserId, tripId, rawInput, context = {}) {
      const input = tripDestinationCreateInputSchema.parse(rawInput);
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const ownedTrip = await lockOwnedTrip(transaction, authUserId, tripId);
        assertRevision(ownedTrip.trip.revision, input.expectedTripRevision);
        await requirePlace(transaction, input.placeId);
        const [duplicate] = await transaction
          .select({ id: tripDestinations.id })
          .from(tripDestinations)
          .where(
            and(eq(tripDestinations.tripId, tripId), eq(tripDestinations.placeId, input.placeId)),
          )
          .limit(1);
        if (duplicate) {
          throw new TripDomainInputError("The destination is already part of this trip.");
        }
        const total = await collectionCount(
          transaction,
          tripDestinations,
          eq(tripDestinations.tripId, tripId),
        );
        const orderIndex = input.orderIndex ?? total;
        assertOrderIndex(orderIndex, total, true);
        await shiftForInsert(transaction, "trip_destinations", "trip_id", tripId, orderIndex);
        const [destination] = await transaction
          .insert(tripDestinations)
          .values({
            arrivalAt: input.arrivalAt ? new Date(input.arrivalAt) : null,
            departureAt: input.departureAt ? new Date(input.departureAt) : null,
            orderIndex,
            placeId: input.placeId,
            tripId,
          })
          .returning();
        return {
          destination: serializeDestination(destination!),
          tripRevision: await bumpTrip(transaction, ownedTrip.trip, now),
        };
      });
    },

    async updateDestination(authUserId, tripId, destinationId, rawInput, context = {}) {
      const input = tripDestinationUpdateInputSchema.parse(rawInput);
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const ownedTrip = await lockOwnedTrip(transaction, authUserId, tripId);
        assertRevision(ownedTrip.trip.revision, input.expectedTripRevision);
        const [current] = await transaction
          .select()
          .from(tripDestinations)
          .where(and(eq(tripDestinations.id, destinationId), eq(tripDestinations.tripId, tripId)))
          .limit(1);
        if (!current) {
          throw new AuthorizedResourceNotFoundError();
        }
        if (input.placeId && input.placeId !== current.placeId) {
          await requirePlace(transaction, input.placeId);
          const [duplicate] = await transaction
            .select({ id: tripDestinations.id })
            .from(tripDestinations)
            .where(
              and(eq(tripDestinations.tripId, tripId), eq(tripDestinations.placeId, input.placeId)),
            )
            .limit(1);
          if (duplicate) {
            throw new TripDomainInputError("The destination is already part of this trip.");
          }
        }
        const arrivalAt =
          input.arrivalAt === undefined
            ? current.arrivalAt
            : input.arrivalAt === null
              ? null
              : new Date(input.arrivalAt);
        const departureAt =
          input.departureAt === undefined
            ? current.departureAt
            : input.departureAt === null
              ? null
              : new Date(input.departureAt);
        if (arrivalAt && departureAt && departureAt <= arrivalAt) {
          throw new TripDomainInputError("Departure must be after arrival.");
        }
        const total = await collectionCount(
          transaction,
          tripDestinations,
          eq(tripDestinations.tripId, tripId),
        );
        const orderIndex = input.orderIndex ?? current.orderIndex;
        assertOrderIndex(orderIndex, total, false);
        await moveOrderedRow(
          transaction,
          "trip_destinations",
          "trip_id",
          tripId,
          destinationId,
          current.orderIndex,
          orderIndex,
        );
        const [destination] = await transaction
          .update(tripDestinations)
          .set({ arrivalAt, departureAt, orderIndex, placeId: input.placeId })
          .where(eq(tripDestinations.id, destinationId))
          .returning();
        return {
          destination: serializeDestination(destination!),
          tripRevision: await bumpTrip(transaction, ownedTrip.trip, now),
        };
      });
    },

    async deleteDestination(authUserId, tripId, destinationId, rawInput, context = {}) {
      const input = tripChildDeleteInputSchema.parse(rawInput);
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const ownedTrip = await lockOwnedTrip(transaction, authUserId, tripId);
        assertRevision(ownedTrip.trip.revision, input.expectedTripRevision);
        const [current] = await transaction
          .select()
          .from(tripDestinations)
          .where(and(eq(tripDestinations.id, destinationId), eq(tripDestinations.tripId, tripId)))
          .limit(1);
        if (!current) {
          throw new AuthorizedResourceNotFoundError();
        }
        await transaction.delete(tripDestinations).where(eq(tripDestinations.id, destinationId));
        await closeOrderGap(
          transaction,
          "trip_destinations",
          "trip_id",
          tripId,
          current.orderIndex,
        );
        await recordDeletion(transaction, ownedTrip.actorUserId, "trip", tripId, {
          ...context,
          now,
        });
        return {
          deletedId: destinationId,
          tripRevision: await bumpTrip(transaction, ownedTrip.trip, now),
        };
      });
    },

    async createDay(authUserId, tripId, rawInput, context = {}) {
      const input = tripDayCreateInputSchema.parse(rawInput);
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const ownedTrip = await lockOwnedTrip(transaction, authUserId, tripId);
        assertRevision(ownedTrip.trip.revision, input.expectedTripRevision);
        assertDateWithinTrip(ownedTrip.trip, input.localDate);
        const [duplicate] = await transaction
          .select({ id: itineraryDays.id })
          .from(itineraryDays)
          .where(
            and(eq(itineraryDays.tripId, tripId), eq(itineraryDays.localDate, input.localDate)),
          )
          .limit(1);
        if (duplicate) {
          throw new TripDomainInputError("An itinerary day already exists for this date.");
        }
        const total = await collectionCount(
          transaction,
          itineraryDays,
          eq(itineraryDays.tripId, tripId),
        );
        const orderIndex = input.orderIndex ?? total;
        assertOrderIndex(orderIndex, total, true);
        await shiftForInsert(transaction, "itinerary_days", "trip_id", tripId, orderIndex);
        const [day] = await transaction
          .insert(itineraryDays)
          .values({
            localDate: input.localDate,
            notes: input.notes,
            orderIndex,
            timezone: input.timezone,
            title: input.title,
            tripId,
          })
          .returning();
        return {
          day: serializeDay(day!),
          tripRevision: await bumpTrip(transaction, ownedTrip.trip, now),
        };
      });
    },

    async updateDay(authUserId, tripId, dayId, rawInput, context = {}) {
      const input = tripDayUpdateInputSchema.parse(rawInput);
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const ownedTrip = await lockOwnedTrip(transaction, authUserId, tripId);
        assertRevision(ownedTrip.trip.revision, input.expectedTripRevision);
        const [current] = await transaction
          .select()
          .from(itineraryDays)
          .where(and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, tripId)))
          .limit(1);
        if (!current) {
          throw new AuthorizedResourceNotFoundError();
        }
        const localDate = input.localDate ?? current.localDate;
        assertDateWithinTrip(ownedTrip.trip, localDate);
        if (input.localDate && input.localDate !== current.localDate) {
          const [duplicate] = await transaction
            .select({ id: itineraryDays.id })
            .from(itineraryDays)
            .where(
              and(eq(itineraryDays.tripId, tripId), eq(itineraryDays.localDate, input.localDate)),
            )
            .limit(1);
          if (duplicate) {
            throw new TripDomainInputError("An itinerary day already exists for this date.");
          }
        }
        const total = await collectionCount(
          transaction,
          itineraryDays,
          eq(itineraryDays.tripId, tripId),
        );
        const orderIndex = input.orderIndex ?? current.orderIndex;
        assertOrderIndex(orderIndex, total, false);
        await moveOrderedRow(
          transaction,
          "itinerary_days",
          "trip_id",
          tripId,
          dayId,
          current.orderIndex,
          orderIndex,
        );
        const [day] = await transaction
          .update(itineraryDays)
          .set({
            localDate: input.localDate,
            notes: input.notes,
            orderIndex,
            timezone: input.timezone,
            title: input.title,
          })
          .where(eq(itineraryDays.id, dayId))
          .returning();
        const itemRows = await transaction
          .select()
          .from(itineraryItems)
          .where(eq(itineraryItems.itineraryDayId, dayId))
          .orderBy(asc(itineraryItems.orderIndex), asc(itineraryItems.id));
        return {
          day: serializeDay(day!, itemRows.map(serializeItem)),
          tripRevision: await bumpTrip(transaction, ownedTrip.trip, now),
        };
      });
    },

    async deleteDay(authUserId, tripId, dayId, rawInput, context = {}) {
      const input = tripChildDeleteInputSchema.parse(rawInput);
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const ownedTrip = await lockOwnedTrip(transaction, authUserId, tripId);
        assertRevision(ownedTrip.trip.revision, input.expectedTripRevision);
        const [current] = await transaction
          .select()
          .from(itineraryDays)
          .where(and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, tripId)))
          .limit(1);
        if (!current) {
          throw new AuthorizedResourceNotFoundError();
        }
        await transaction.delete(itineraryDays).where(eq(itineraryDays.id, dayId));
        await closeOrderGap(transaction, "itinerary_days", "trip_id", tripId, current.orderIndex);
        await recordDeletion(transaction, ownedTrip.actorUserId, "trip", tripId, {
          ...context,
          now,
        });
        return {
          deletedId: dayId,
          tripRevision: await bumpTrip(transaction, ownedTrip.trip, now),
        };
      });
    },

    async createItem(authUserId, tripId, rawInput, context = {}) {
      const input = tripItemCreateInputSchema.parse(rawInput);
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const ownedTrip = await lockOwnedTrip(transaction, authUserId, tripId);
        assertRevision(ownedTrip.trip.revision, input.expectedTripRevision);
        const [day] = await transaction
          .select({ id: itineraryDays.id })
          .from(itineraryDays)
          .where(and(eq(itineraryDays.id, input.itineraryDayId), eq(itineraryDays.tripId, tripId)))
          .limit(1);
        if (!day) {
          throw new AuthorizedResourceNotFoundError();
        }
        if (input.placeId) {
          await requirePlace(transaction, input.placeId);
        }
        const total = await collectionCount(
          transaction,
          itineraryItems,
          eq(itineraryItems.itineraryDayId, input.itineraryDayId),
        );
        const orderIndex = input.orderIndex ?? total;
        assertOrderIndex(orderIndex, total, true);
        await shiftForInsert(
          transaction,
          "itinerary_items",
          "itinerary_day_id",
          input.itineraryDayId,
          orderIndex,
        );
        const [item] = await transaction
          .insert(itineraryItems)
          .values({
            booking: input.booking,
            confidence: input.confidence,
            durationMinutes: input.durationMinutes,
            endTime: input.endTime,
            estimatedCost: input.estimatedCost ?? {},
            itineraryDayId: input.itineraryDayId,
            itemType: input.itemType,
            notes: input.notes,
            orderIndex,
            placeId: input.placeId,
            sourceSnapshot: input.sourceSnapshot,
            startTime: input.startTime,
            transport: input.transport,
          })
          .returning();
        return {
          item: serializeItem(item!),
          tripRevision: await bumpTrip(transaction, ownedTrip.trip, now),
        };
      });
    },

    async updateItem(authUserId, tripId, itemId, rawInput, context = {}) {
      const input = tripItemUpdateInputSchema.parse(rawInput);
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const ownedTrip = await lockOwnedTrip(transaction, authUserId, tripId);
        assertRevision(ownedTrip.trip.revision, input.expectedTripRevision);
        const [current] = await transaction
          .select({ item: itineraryItems })
          .from(itineraryItems)
          .innerJoin(itineraryDays, eq(itineraryItems.itineraryDayId, itineraryDays.id))
          .where(and(eq(itineraryItems.id, itemId), eq(itineraryDays.tripId, tripId)))
          .limit(1);
        if (!current) {
          throw new AuthorizedResourceNotFoundError();
        }
        const currentItem = current.item;
        const targetDayId = input.itineraryDayId ?? currentItem.itineraryDayId;
        if (targetDayId !== currentItem.itineraryDayId) {
          const [targetDay] = await transaction
            .select({ id: itineraryDays.id })
            .from(itineraryDays)
            .where(and(eq(itineraryDays.id, targetDayId), eq(itineraryDays.tripId, tripId)))
            .limit(1);
          if (!targetDay) {
            throw new AuthorizedResourceNotFoundError();
          }
        }
        if (input.placeId) {
          await requirePlace(transaction, input.placeId);
        }
        const startTime = input.startTime === undefined ? currentItem.startTime : input.startTime;
        const endTime = input.endTime === undefined ? currentItem.endTime : input.endTime;
        assertTimePair(startTime, endTime);

        let orderIndex: number;
        if (targetDayId === currentItem.itineraryDayId) {
          const total = await collectionCount(
            transaction,
            itineraryItems,
            eq(itineraryItems.itineraryDayId, targetDayId),
          );
          orderIndex = input.orderIndex ?? currentItem.orderIndex;
          assertOrderIndex(orderIndex, total, false);
          await moveOrderedRow(
            transaction,
            "itinerary_items",
            "itinerary_day_id",
            targetDayId,
            itemId,
            currentItem.orderIndex,
            orderIndex,
          );
        } else {
          await transaction
            .update(itineraryItems)
            .set({ orderIndex: MOVED_ORDER_INDEX })
            .where(eq(itineraryItems.id, itemId));
          await closeOrderGap(
            transaction,
            "itinerary_items",
            "itinerary_day_id",
            currentItem.itineraryDayId,
            currentItem.orderIndex,
          );
          const targetCount = await collectionCount(
            transaction,
            itineraryItems,
            eq(itineraryItems.itineraryDayId, targetDayId),
          );
          orderIndex = input.orderIndex ?? targetCount;
          assertOrderIndex(orderIndex, targetCount, true);
          await shiftForInsert(
            transaction,
            "itinerary_items",
            "itinerary_day_id",
            targetDayId,
            orderIndex,
          );
        }
        const [item] = await transaction
          .update(itineraryItems)
          .set({
            booking: input.booking,
            confidence: input.confidence,
            durationMinutes: input.durationMinutes,
            endTime: input.endTime,
            estimatedCost:
              input.estimatedCost === undefined ? undefined : (input.estimatedCost ?? {}),
            itineraryDayId: targetDayId,
            itemType: input.itemType,
            notes: input.notes,
            orderIndex,
            placeId: input.placeId,
            sourceSnapshot: input.sourceSnapshot,
            startTime: input.startTime,
            transport: input.transport,
          })
          .where(eq(itineraryItems.id, itemId))
          .returning();
        return {
          item: serializeItem(item!),
          tripRevision: await bumpTrip(transaction, ownedTrip.trip, now),
        };
      });
    },

    async deleteItem(authUserId, tripId, itemId, rawInput, context = {}) {
      const input = tripChildDeleteInputSchema.parse(rawInput);
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const ownedTrip = await lockOwnedTrip(transaction, authUserId, tripId);
        assertRevision(ownedTrip.trip.revision, input.expectedTripRevision);
        const [current] = await transaction
          .select({ item: itineraryItems })
          .from(itineraryItems)
          .innerJoin(itineraryDays, eq(itineraryItems.itineraryDayId, itineraryDays.id))
          .where(and(eq(itineraryItems.id, itemId), eq(itineraryDays.tripId, tripId)))
          .limit(1);
        if (!current) {
          throw new AuthorizedResourceNotFoundError();
        }
        await transaction.delete(itineraryItems).where(eq(itineraryItems.id, itemId));
        await closeOrderGap(
          transaction,
          "itinerary_items",
          "itinerary_day_id",
          current.item.itineraryDayId,
          current.item.orderIndex,
        );
        await recordDeletion(transaction, ownedTrip.actorUserId, "itinerary_item", itemId, {
          ...context,
          now,
        });
        return {
          deletedId: itemId,
          tripRevision: await bumpTrip(transaction, ownedTrip.trip, now),
        };
      });
    },
  };
}
