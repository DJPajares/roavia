import {
  itineraryItemSourceSnapshotSchema,
  itineraryRouteSnapshotSchema,
  sharedTripSchema,
  tripMoneySchema,
  type ShareLink,
  type ShareLinkCreateInput,
  type SharedTrip,
} from "@roavia/contracts";
import { and, asc, eq, gt, isNull } from "drizzle-orm";

import {
  AuthorizedResourceNotFoundError,
  createShareLink,
  hashShareToken,
  requireOwnedTrip,
  revokeShareLink,
} from "./authorization.js";
import type { Database } from "./client.js";
import { itineraryDays, itineraryItems, shareLinks, trips } from "./schema.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface ShareMutationContext {
  correlationId?: string;
  now?: Date;
}

export interface ShareRepository {
  createLink(
    authUserId: string,
    tripId: string,
    input: ShareLinkCreateInput,
    context?: ShareMutationContext,
  ): Promise<{ link: ShareLink; token: string }>;
  listLinks(authUserId: string, tripId: string, now?: Date): Promise<ShareLink[]>;
  revokeLink(
    authUserId: string,
    tripId: string,
    shareLinkId: string,
    context?: ShareMutationContext,
  ): Promise<{ id: string; revokedAt: string }>;
  getSharedTrip(token: string, now?: Date): Promise<SharedTrip>;
}

function statusFor(link: { expiresAt: Date; revokedAt: Date | null }, now: Date) {
  if (link.revokedAt) return "revoked" as const;
  if (link.expiresAt <= now) return "expired" as const;
  return "active" as const;
}

function serializeLink(
  link: {
    id: string;
    permission: "view";
    createdAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  },
  now: Date,
): ShareLink {
  return {
    id: link.id,
    permission: link.permission,
    status: statusFor(link, now),
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    revokedAt: link.revokedAt?.toISOString() ?? null,
  };
}

function routeFromTransport(transport: Record<string, unknown>) {
  const candidate = transport.route ?? transport;
  const result = itineraryRouteSnapshotSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

export function createShareRepository(db: Database): ShareRepository {
  return {
    async createLink(authUserId, tripId, input, context = {}) {
      const now = context.now ?? new Date();
      const created = await createShareLink(db, {
        authUserId,
        correlationId: context.correlationId,
        expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS),
        now,
        tripId,
      });
      return {
        link: serializeLink({ ...created, revokedAt: null }, now),
        token: created.token,
      };
    },

    async listLinks(authUserId, tripId, now = new Date()) {
      await requireOwnedTrip(db, authUserId, tripId);
      const rows = await db
        .select({
          id: shareLinks.id,
          permission: shareLinks.permission,
          createdAt: shareLinks.createdAt,
          expiresAt: shareLinks.expiresAt,
          revokedAt: shareLinks.revokedAt,
        })
        .from(shareLinks)
        .where(eq(shareLinks.tripId, tripId))
        .orderBy(asc(shareLinks.createdAt), asc(shareLinks.id));
      return rows.map((row) => serializeLink(row, now));
    },

    async revokeLink(authUserId, tripId, shareLinkId, context = {}) {
      const revoked = await revokeShareLink(db, {
        authUserId,
        correlationId: context.correlationId,
        now: context.now,
        shareLinkId,
        tripId,
      });
      return { id: revoked.id, revokedAt: revoked.revokedAt.toISOString() };
    },

    async getSharedTrip(token, now = new Date()) {
      let tokenHash: Buffer;
      try {
        tokenHash = hashShareToken(token);
      } catch {
        throw new AuthorizedResourceNotFoundError();
      }

      return db.transaction(
        async (transaction) => {
          const [shared] = await transaction
            .select({
              tripId: trips.id,
              title: trips.title,
              startDate: trips.startDate,
              endDate: trips.endDate,
              updatedAt: trips.updatedAt,
              expiresAt: shareLinks.expiresAt,
            })
            .from(shareLinks)
            .innerJoin(trips, eq(shareLinks.tripId, trips.id))
            .where(
              and(
                eq(shareLinks.tokenHash, tokenHash),
                eq(shareLinks.permission, "view"),
                eq(trips.visibility, "link"),
                isNull(shareLinks.revokedAt),
                gt(shareLinks.expiresAt, now),
              ),
            )
            .limit(1);
          if (!shared) throw new AuthorizedResourceNotFoundError();

          const [dayRows, itemRows] = await Promise.all([
            transaction
              .select()
              .from(itineraryDays)
              .where(eq(itineraryDays.tripId, shared.tripId))
              .orderBy(asc(itineraryDays.orderIndex), asc(itineraryDays.id)),
            transaction
              .select({ item: itineraryItems })
              .from(itineraryItems)
              .innerJoin(itineraryDays, eq(itineraryItems.itineraryDayId, itineraryDays.id))
              .where(eq(itineraryDays.tripId, shared.tripId))
              .orderBy(
                asc(itineraryDays.orderIndex),
                asc(itineraryItems.orderIndex),
                asc(itineraryItems.id),
              ),
          ]);
          const itemsByDay = new Map<string, SharedTrip["days"][number]["items"]>();
          for (const { item } of itemRows) {
            const source = itineraryItemSourceSnapshotSchema.safeParse(item.sourceSnapshot);
            const cost = tripMoneySchema.safeParse(item.estimatedCost);
            const items = itemsByDay.get(item.itineraryDayId) ?? [];
            items.push({
              itemType: item.itemType,
              startTime: item.startTime,
              endTime: item.endTime,
              durationMinutes: item.durationMinutes,
              estimatedCost: cost.success ? cost.data : null,
              sourceSnapshot: source.success ? source.data : {},
              route: routeFromTransport(item.transport),
              confidence: item.confidence,
              notes: item.notes,
              orderIndex: item.orderIndex,
            });
            itemsByDay.set(item.itineraryDayId, items);
          }

          return sharedTripSchema.parse({
            title: shared.title,
            startDate: shared.startDate,
            endDate: shared.endDate,
            updatedAt: shared.updatedAt.toISOString(),
            expiresAt: shared.expiresAt.toISOString(),
            days: dayRows.map((day) => ({
              localDate: day.localDate,
              timezone: day.timezone,
              title: day.title,
              notes: day.notes,
              orderIndex: day.orderIndex,
              items: itemsByDay.get(day.id) ?? [],
            })),
          });
        },
        { accessMode: "read only", isolationLevel: "repeatable read" },
      );
    },
  };
}
