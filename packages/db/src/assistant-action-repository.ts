import { randomUUID } from "node:crypto";

import {
  assistantActionPayloadSchema,
  assistantActionPreviewSchema,
  type AssistantActionPayload,
  type AssistantActionPreview,
} from "@roavia/contracts";
import { and, eq } from "drizzle-orm";

import { AuthorizedResourceNotFoundError } from "./authorization.js";
import type { Database } from "./client.js";
import { assistantActions, auditEvents, trips, users } from "./schema.js";

const DEFAULT_ACTION_LIFETIME_MS = 15 * 60 * 1_000;
const MAXIMUM_ACTION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export class AssistantActionConflictError extends Error {
  readonly code = "assistant_action_conflict" as const;

  constructor(message = "This assistant action is no longer available.") {
    super(message);
    this.name = "AssistantActionConflictError";
  }
}

export interface AssistantActionContext {
  correlationId?: string;
  expiresAt?: Date;
  now?: Date;
}

export interface ClaimedAssistantAction {
  actionId: string;
  correlationId: string;
  expectedTripRevision: number;
  payload: AssistantActionPayload;
  tripId: string;
}

export interface AssistantActionRepository {
  createPreviews(
    authUserId: string,
    tripId: string,
    expectedTripRevision: number,
    payloads: AssistantActionPayload[],
    context?: AssistantActionContext,
  ): Promise<AssistantActionPreview[]>;
  claim(
    authUserId: string,
    actionId: string,
    context?: Pick<AssistantActionContext, "now">,
  ): Promise<ClaimedAssistantAction>;
  cancel(
    authUserId: string,
    actionId: string,
    context?: Pick<AssistantActionContext, "now">,
  ): Promise<{ actionId: string; correlationId: string; tripId: string }>;
  resolve(
    actionId: string,
    outcome: "applied" | "failed",
    context?: Pick<AssistantActionContext, "now">,
  ): Promise<void>;
}

function expiryFor(now: Date, candidate?: Date): Date {
  const expiresAt = candidate ?? new Date(now.getTime() + DEFAULT_ACTION_LIFETIME_MS);
  const lifetime = expiresAt.getTime() - now.getTime();
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    lifetime <= 0 ||
    lifetime > MAXIMUM_ACTION_LIFETIME_MS
  ) {
    throw new RangeError("Assistant actions must expire within 24 hours.");
  }
  return expiresAt;
}

function auditExpiry(occurredAt: Date): Date {
  const expiresAt = new Date(occurredAt);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  return expiresAt;
}

export function createAssistantActionRepository(db: Database): AssistantActionRepository {
  return {
    async createPreviews(authUserId, tripId, expectedTripRevision, rawPayloads, context = {}) {
      if (rawPayloads.length === 0) return [];
      const payloads = rawPayloads.map((payload) => assistantActionPayloadSchema.parse(payload));
      const now = context.now ?? new Date();
      const expiresAt = expiryFor(now, context.expiresAt);
      const correlationId = context.correlationId ?? randomUUID();
      return db.transaction(async (transaction) => {
        const [ownedTrip] = await transaction
          .select({ ownerUserId: users.id, revision: trips.revision })
          .from(trips)
          .innerJoin(users, eq(trips.ownerUserId, users.id))
          .where(and(eq(trips.id, tripId), eq(users.authUserId, authUserId)))
          .limit(1);
        if (!ownedTrip) throw new AuthorizedResourceNotFoundError();
        if (ownedTrip.revision !== expectedTripRevision) {
          throw new AssistantActionConflictError(
            "The trip changed before these assistant actions could be previewed.",
          );
        }
        const rows = await transaction
          .insert(assistantActions)
          .values(
            payloads.map((payload) => ({
              correlationId,
              createdAt: now,
              expiresAt,
              kind: payload.kind,
              ownerUserId: ownedTrip.ownerUserId,
              payload,
              status: "pending" as const,
              tripId,
              tripRevision: expectedTripRevision,
              updatedAt: now,
            })),
          )
          .returning();
        return rows.map((row) =>
          assistantActionPreviewSchema.parse({
            actionId: row.id,
            expectedTripRevision: row.tripRevision,
            expiresAt: row.expiresAt.toISOString(),
            payload: row.payload,
            status: row.status,
            tripId: row.tripId,
          }),
        );
      });
    },

    async claim(authUserId, actionId, context = {}) {
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const [row] = await transaction
          .select({ action: assistantActions })
          .from(assistantActions)
          .innerJoin(users, eq(assistantActions.ownerUserId, users.id))
          .where(and(eq(assistantActions.id, actionId), eq(users.authUserId, authUserId)))
          .for("update")
          .limit(1);
        if (!row) throw new AuthorizedResourceNotFoundError();
        if (row.action.status !== "pending" || row.action.expiresAt <= now) {
          throw new AssistantActionConflictError();
        }
        const payload = assistantActionPayloadSchema.parse(row.action.payload);
        await transaction
          .update(assistantActions)
          .set({ confirmedAt: now, status: "confirmed", updatedAt: now })
          .where(eq(assistantActions.id, actionId));
        return {
          actionId,
          correlationId: row.action.correlationId,
          expectedTripRevision: row.action.tripRevision,
          payload,
          tripId: row.action.tripId,
        };
      });
    },

    async cancel(authUserId, actionId, context = {}) {
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const [row] = await transaction
          .select({ action: assistantActions })
          .from(assistantActions)
          .innerJoin(users, eq(assistantActions.ownerUserId, users.id))
          .where(and(eq(assistantActions.id, actionId), eq(users.authUserId, authUserId)))
          .for("update")
          .limit(1);
        if (!row) throw new AuthorizedResourceNotFoundError();
        if (row.action.status !== "pending") throw new AssistantActionConflictError();
        await transaction
          .update(assistantActions)
          .set({ resolvedAt: now, status: "cancelled", updatedAt: now })
          .where(eq(assistantActions.id, actionId));
        return {
          actionId,
          correlationId: row.action.correlationId,
          tripId: row.action.tripId,
        };
      });
    },

    async resolve(actionId, outcome, context = {}) {
      const now = context.now ?? new Date();
      await db.transaction(async (transaction) => {
        const [row] = await transaction
          .select({ action: assistantActions })
          .from(assistantActions)
          .where(eq(assistantActions.id, actionId))
          .for("update")
          .limit(1);
        if (!row || row.action.status !== "confirmed") {
          throw new AssistantActionConflictError();
        }
        await transaction
          .update(assistantActions)
          .set({ resolvedAt: now, status: outcome, updatedAt: now })
          .where(eq(assistantActions.id, actionId));
        await transaction.insert(auditEvents).values({
          action: "ai_action_applied",
          actorUserId: row.action.ownerUserId,
          correlationId: row.action.correlationId,
          expiresAt: auditExpiry(now),
          occurredAt: now,
          outcome: outcome === "applied" ? "succeeded" : "failed",
          subjectId: actionId,
          subjectType: "assistant_action",
        });
      });
    },
  };
}
