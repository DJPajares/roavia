import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "./client.js";
import { auditEvents, shareLinks, travelProfiles, trips, users } from "./schema.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_SHARE_LIFETIME_MS = 30 * DAY_MS;
const MAXIMUM_SHARE_LIFETIME_MS = 180 * DAY_MS;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AuditAction =
  "share_link_created" | "share_link_revoked" | "resource_deleted" | "ai_action_applied";
export type AuditOutcome = "succeeded" | "denied" | "failed";
export type AuditSubjectType =
  "account" | "trip" | "share_link" | "itinerary_item" | "assistant_action";

export type TripPrincipal = { kind: "user"; authUserId: string } | { kind: "share"; token: string };

export interface TripAccess {
  tripId: string;
  ownerUserId: string;
  permission: "owner" | "view";
}

export interface AuditEventInput {
  action: AuditAction;
  actorUserId: string | null;
  correlationId?: string;
  occurredAt?: Date;
  outcome: AuditOutcome;
  subjectId: string;
  subjectType: AuditSubjectType;
}

export interface CreateShareLinkOptions {
  authUserId: string;
  correlationId?: string;
  expiresAt?: Date;
  now?: Date;
  tripId: string;
}

export interface RevokeShareLinkOptions {
  authUserId: string;
  correlationId?: string;
  now?: Date;
  shareLinkId: string;
  tripId: string;
}

export class AuthorizedResourceNotFoundError extends Error {
  readonly code = "not_found" as const;

  constructor() {
    super("Resource not found.");
    this.name = "AuthorizedResourceNotFoundError";
  }
}

function auditExpiry(occurredAt: Date): Date {
  const expiresAt = new Date(occurredAt);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  return expiresAt;
}

function validatedShareExpiry(now: Date, candidate?: Date): Date {
  const expiresAt = candidate ?? new Date(now.getTime() + DEFAULT_SHARE_LIFETIME_MS);
  const lifetime = expiresAt.getTime() - now.getTime();

  if (
    !Number.isFinite(expiresAt.getTime()) ||
    lifetime <= 0 ||
    lifetime > MAXIMUM_SHARE_LIFETIME_MS
  ) {
    throw new RangeError("Share links must expire within 180 days.");
  }

  return expiresAt;
}

export function createShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string): Buffer {
  if (!SHARE_TOKEN_PATTERN.test(token)) {
    throw new TypeError("Share token format is invalid.");
  }

  return createHash("sha256").update(token, "utf8").digest();
}

export async function findOwnedTrip(db: Database, authUserId: string, tripId: string) {
  const [ownedTrip] = await db
    .select({
      id: trips.id,
      ownerUserId: trips.ownerUserId,
      title: trips.title,
      visibility: trips.visibility,
    })
    .from(trips)
    .innerJoin(users, eq(trips.ownerUserId, users.id))
    .where(and(eq(trips.id, tripId), eq(users.authUserId, authUserId)))
    .limit(1);

  return ownedTrip ?? null;
}

export async function requireOwnedTrip(db: Database, authUserId: string, tripId: string) {
  const ownedTrip = await findOwnedTrip(db, authUserId, tripId);
  if (!ownedTrip) {
    throw new AuthorizedResourceNotFoundError();
  }
  return ownedTrip;
}

export async function getOwnedTravelProfile(db: Database, authUserId: string) {
  const [profile] = await db
    .select({
      id: travelProfiles.id,
      userId: travelProfiles.userId,
      defaultBudgetStyle: travelProfiles.defaultBudgetStyle,
      defaultPace: travelProfiles.defaultPace,
      interests: travelProfiles.interests,
      dietaryNeeds: travelProfiles.dietaryNeeds,
      accessibilityNeeds: travelProfiles.accessibilityNeeds,
      travelPreferences: travelProfiles.travelPreferences,
      createdAt: travelProfiles.createdAt,
      updatedAt: travelProfiles.updatedAt,
    })
    .from(travelProfiles)
    .innerJoin(users, eq(travelProfiles.userId, users.id))
    .where(eq(users.authUserId, authUserId))
    .limit(1);

  return profile ?? null;
}

export async function authorizeTripAccess(
  db: Database,
  tripId: string,
  principal: TripPrincipal,
  now = new Date(),
): Promise<TripAccess | null> {
  if (principal.kind === "user") {
    const ownedTrip = await findOwnedTrip(db, principal.authUserId, tripId);
    return ownedTrip
      ? { tripId: ownedTrip.id, ownerUserId: ownedTrip.ownerUserId, permission: "owner" }
      : null;
  }

  let tokenHash: Buffer;
  try {
    tokenHash = hashShareToken(principal.token);
  } catch {
    return null;
  }

  const [sharedTrip] = await db
    .select({ tripId: trips.id, ownerUserId: trips.ownerUserId })
    .from(shareLinks)
    .innerJoin(trips, eq(shareLinks.tripId, trips.id))
    .where(
      and(
        eq(trips.id, tripId),
        eq(trips.visibility, "link"),
        eq(shareLinks.tokenHash, tokenHash),
        eq(shareLinks.permission, "view"),
        isNull(shareLinks.revokedAt),
        gt(shareLinks.expiresAt, now),
      ),
    )
    .limit(1);

  return sharedTrip ? { ...sharedTrip, permission: "view" } : null;
}

export async function recordAuditEvent(db: Database, input: AuditEventInput) {
  const occurredAt = input.occurredAt ?? new Date();
  const [event] = await db
    .insert(auditEvents)
    .values({
      action: input.action,
      actorUserId: input.actorUserId,
      correlationId: input.correlationId ?? randomUUID(),
      expiresAt: auditExpiry(occurredAt),
      occurredAt,
      outcome: input.outcome,
      subjectId: input.subjectId,
      subjectType: input.subjectType,
    })
    .returning();

  return event!;
}

export async function createShareLink(db: Database, options: CreateShareLinkOptions) {
  const now = options.now ?? new Date();
  const expiresAt = validatedShareExpiry(now, options.expiresAt);
  const token = createShareToken();
  const tokenHash = hashShareToken(token);

  return db.transaction(async (transaction) => {
    const [owner] = await transaction
      .select({ userId: users.id })
      .from(trips)
      .innerJoin(users, eq(trips.ownerUserId, users.id))
      .where(and(eq(trips.id, options.tripId), eq(users.authUserId, options.authUserId)))
      .limit(1);

    if (!owner) {
      throw new AuthorizedResourceNotFoundError();
    }

    const [shareLink] = await transaction
      .insert(shareLinks)
      .values({ createdAt: now, expiresAt, permission: "view", tokenHash, tripId: options.tripId })
      .returning({
        id: shareLinks.id,
        tripId: shareLinks.tripId,
        permission: shareLinks.permission,
        expiresAt: shareLinks.expiresAt,
        createdAt: shareLinks.createdAt,
      });

    await transaction
      .update(trips)
      .set({ updatedAt: now, visibility: "link" })
      .where(and(eq(trips.id, options.tripId), eq(trips.ownerUserId, owner.userId)));

    await transaction.insert(auditEvents).values({
      action: "share_link_created",
      actorUserId: owner.userId,
      correlationId: options.correlationId ?? randomUUID(),
      expiresAt: auditExpiry(now),
      occurredAt: now,
      outcome: "succeeded",
      subjectId: shareLink!.id,
      subjectType: "share_link",
    });

    return { ...shareLink!, token };
  });
}

export async function revokeShareLink(db: Database, options: RevokeShareLinkOptions) {
  const now = options.now ?? new Date();

  return db.transaction(async (transaction) => {
    const [ownedShareLink] = await transaction
      .select({ id: shareLinks.id, ownerUserId: trips.ownerUserId })
      .from(shareLinks)
      .innerJoin(trips, eq(shareLinks.tripId, trips.id))
      .innerJoin(users, eq(trips.ownerUserId, users.id))
      .where(
        and(
          eq(shareLinks.id, options.shareLinkId),
          eq(shareLinks.tripId, options.tripId),
          eq(users.authUserId, options.authUserId),
          isNull(shareLinks.revokedAt),
        ),
      )
      .limit(1)
      .for("update");

    if (!ownedShareLink) {
      throw new AuthorizedResourceNotFoundError();
    }

    await transaction
      .update(shareLinks)
      .set({ revokedAt: now })
      .where(and(eq(shareLinks.id, ownedShareLink.id), isNull(shareLinks.revokedAt)));

    await transaction.insert(auditEvents).values({
      action: "share_link_revoked",
      actorUserId: ownedShareLink.ownerUserId,
      correlationId: options.correlationId ?? randomUUID(),
      expiresAt: auditExpiry(now),
      occurredAt: now,
      outcome: "succeeded",
      subjectId: ownedShareLink.id,
      subjectType: "share_link",
    });

    const [otherActiveLink] = await transaction
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(
        and(
          eq(shareLinks.tripId, options.tripId),
          isNull(shareLinks.revokedAt),
          gt(shareLinks.expiresAt, now),
        ),
      )
      .limit(1);

    if (!otherActiveLink) {
      await transaction
        .update(trips)
        .set({ updatedAt: now, visibility: "private" })
        .where(
          and(eq(trips.id, options.tripId), eq(trips.ownerUserId, ownedShareLink.ownerUserId)),
        );
    }

    return { id: ownedShareLink.id, revokedAt: now };
  });
}
