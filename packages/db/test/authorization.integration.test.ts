import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  AuthorizedResourceNotFoundError,
  authorizeTripAccess,
  createShareLink,
  findOwnedTrip,
  getOwnedTravelProfile,
  hashShareToken,
  recordAuditEvent,
  requireOwnedTrip,
  revokeShareLink,
} from "../src/authorization.js";
import { createDatabaseClient } from "../src/client.js";
import { createShareRepository } from "../src/share-repository.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

interface AuthorizationFixture {
  aliceAuthUserId: string;
  aliceProfileId: string;
  aliceTripId: string;
  aliceUserId: string;
  bobAuthUserId: string;
  bobTripId: string;
  bobUserId: string;
}

async function seedAuthorizationFixture(
  client: ReturnType<typeof createDatabaseClient>,
): Promise<AuthorizationFixture> {
  const fixture = {
    aliceAuthUserId: `authorization-alice-${randomUUID()}`,
    aliceProfileId: randomUUID(),
    aliceTripId: randomUUID(),
    aliceUserId: randomUUID(),
    bobAuthUserId: `authorization-bob-${randomUUID()}`,
    bobTripId: randomUUID(),
    bobUserId: randomUUID(),
  };

  await client.pool.query(
    `insert into users (id, auth_user_id, display_name)
     values ($1, $2, 'Authorization Alice'), ($3, $4, 'Authorization Bob')`,
    [fixture.aliceUserId, fixture.aliceAuthUserId, fixture.bobUserId, fixture.bobAuthUserId],
  );
  await client.pool.query(
    `insert into travel_profiles (id, user_id, default_budget_style, default_pace)
     values ($1, $2, 'midrange', 'balanced')`,
    [fixture.aliceProfileId, fixture.aliceUserId],
  );
  await client.pool.query(
    `insert into trips (id, owner_user_id, title, slug, start_date, end_date)
     values
       ($1, $2, 'Alice private trip', 'alice-private-trip', '2026-08-10', '2026-08-15'),
       ($3, $4, 'Bob private trip', 'bob-private-trip', '2026-09-10', '2026-09-15')`,
    [fixture.aliceTripId, fixture.aliceUserId, fixture.bobTripId, fixture.bobUserId],
  );

  return fixture;
}

async function cleanAuthorizationFixture(
  client: ReturnType<typeof createDatabaseClient>,
  fixture: AuthorizationFixture,
  correlationIds: string[],
) {
  if (correlationIds.length > 0) {
    await client.pool.query("delete from audit_events where correlation_id = any($1::uuid[])", [
      correlationIds,
    ]);
  }
  await client.pool.query("delete from users where id = any($1::uuid[])", [
    [fixture.aliceUserId, fixture.bobUserId],
  ]);
}

function rejectionShape(reason: unknown) {
  expect(reason).toBeInstanceOf(AuthorizedResourceNotFoundError);
  const error = reason as AuthorizedResourceNotFoundError;
  return { code: error.code, message: error.message, name: error.name };
}

describeDatabase("ownership and share-link authorization", () => {
  test("scopes owner repositories without revealing cross-user record existence", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const fixture = await seedAuthorizationFixture(client);

    try {
      await expect(
        findOwnedTrip(client.db, fixture.aliceAuthUserId, fixture.aliceTripId),
      ).resolves.toMatchObject({ id: fixture.aliceTripId, ownerUserId: fixture.aliceUserId });
      await expect(
        findOwnedTrip(client.db, fixture.bobAuthUserId, fixture.aliceTripId),
      ).resolves.toBeNull();
      await expect(
        getOwnedTravelProfile(client.db, fixture.aliceAuthUserId),
      ).resolves.toMatchObject({ id: fixture.aliceProfileId, userId: fixture.aliceUserId });
      await expect(getOwnedTravelProfile(client.db, fixture.bobAuthUserId)).resolves.toBeNull();

      const [crossUser, missing] = await Promise.allSettled([
        requireOwnedTrip(client.db, fixture.bobAuthUserId, fixture.aliceTripId),
        requireOwnedTrip(client.db, fixture.aliceAuthUserId, randomUUID()),
      ]);
      if (crossUser.status !== "rejected" || missing.status !== "rejected") {
        throw new Error("Both unauthorized ownership lookups must be rejected.");
      }
      expect(rejectionShape(crossUser.reason)).toEqual(rejectionShape(missing.reason));

      await expect(
        authorizeTripAccess(client.db, fixture.aliceTripId, {
          kind: "user",
          authUserId: fixture.aliceAuthUserId,
        }),
      ).resolves.toEqual({
        ownerUserId: fixture.aliceUserId,
        permission: "owner",
        tripId: fixture.aliceTripId,
      });
      await expect(
        authorizeTripAccess(client.db, fixture.aliceTripId, {
          kind: "user",
          authUserId: fixture.bobAuthUserId,
        }),
      ).resolves.toBeNull();
    } finally {
      await cleanAuthorizationFixture(client, fixture, []);
      await client.close();
    }
  });

  test("stores only hashed high-entropy tokens and denies wrong, expired, or revoked access", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const fixture = await seedAuthorizationFixture(client);
    const correlationIds = [randomUUID(), randomUUID()];
    const now = new Date("2026-07-28T10:00:00.000Z");

    try {
      const share = await createShareLink(client.db, {
        authUserId: fixture.aliceAuthUserId,
        correlationId: correlationIds[0],
        now,
        tripId: fixture.aliceTripId,
      });
      expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(share.expiresAt).toEqual(new Date(now.getTime() + 30 * DAY_MS));

      const stored = await client.pool.query<{
        token_hash: Buffer;
        visibility: string;
      }>(
        `select share_links.token_hash, trips.visibility
         from share_links
         join trips on trips.id = share_links.trip_id
         where share_links.id = $1`,
        [share.id],
      );
      expect(stored.rows[0]?.token_hash).toHaveLength(32);
      expect(stored.rows[0]?.token_hash.equals(hashShareToken(share.token))).toBe(true);
      expect(stored.rows[0]?.visibility).toBe("link");

      await expect(
        authorizeTripAccess(
          client.db,
          fixture.aliceTripId,
          { kind: "share", token: share.token },
          now,
        ),
      ).resolves.toEqual({
        ownerUserId: fixture.aliceUserId,
        permission: "view",
        tripId: fixture.aliceTripId,
      });
      await expect(
        authorizeTripAccess(
          client.db,
          fixture.bobTripId,
          { kind: "share", token: share.token },
          now,
        ),
      ).resolves.toBeNull();
      await expect(
        authorizeTripAccess(
          client.db,
          fixture.aliceTripId,
          { kind: "share", token: "invalid" },
          now,
        ),
      ).resolves.toBeNull();
      await expect(
        authorizeTripAccess(
          client.db,
          fixture.aliceTripId,
          { kind: "share", token: share.token },
          new Date(now.getTime() + 31 * DAY_MS),
        ),
      ).resolves.toBeNull();

      await expect(
        createShareLink(client.db, {
          authUserId: fixture.bobAuthUserId,
          now,
          tripId: fixture.aliceTripId,
        }),
      ).rejects.toBeInstanceOf(AuthorizedResourceNotFoundError);
      await expect(
        revokeShareLink(client.db, {
          authUserId: fixture.bobAuthUserId,
          now,
          shareLinkId: share.id,
          tripId: fixture.aliceTripId,
        }),
      ).rejects.toBeInstanceOf(AuthorizedResourceNotFoundError);

      const revokedAt = new Date(now.getTime() + DAY_MS);
      await revokeShareLink(client.db, {
        authUserId: fixture.aliceAuthUserId,
        correlationId: correlationIds[1],
        now: revokedAt,
        shareLinkId: share.id,
        tripId: fixture.aliceTripId,
      });
      await expect(
        authorizeTripAccess(
          client.db,
          fixture.aliceTripId,
          { kind: "share", token: share.token },
          revokedAt,
        ),
      ).resolves.toBeNull();

      const afterRevocation = await client.pool.query<{ visibility: string }>(
        "select visibility from trips where id = $1",
        [fixture.aliceTripId],
      );
      expect(afterRevocation.rows[0]?.visibility).toBe("private");

      const shareAudit = await client.pool.query<{ action: string; outcome: string }>(
        `select action, outcome
         from audit_events
         where correlation_id = any($1::uuid[])
         order by occurred_at`,
        [correlationIds],
      );
      expect(shareAudit.rows).toEqual([
        { action: "share_link_created", outcome: "succeeded" },
        { action: "share_link_revoked", outcome: "succeeded" },
      ]);

      await expect(
        createShareLink(client.db, {
          authUserId: fixture.aliceAuthUserId,
          expiresAt: new Date(now.getTime() + 181 * DAY_MS),
          now,
          tripId: fixture.aliceTripId,
        }),
      ).rejects.toThrow("Share links must expire within 180 days.");
    } finally {
      await cleanAuthorizationFixture(client, fixture, correlationIds);
      await client.close();
    }
  });

  test("records content-free destructive and AI-application audit events for twelve months", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const fixture = await seedAuthorizationFixture(client);
    const correlationIds = [randomUUID(), randomUUID()];
    const occurredAt = new Date("2026-07-28T12:00:00.000Z");

    try {
      await recordAuditEvent(client.db, {
        action: "resource_deleted",
        actorUserId: fixture.aliceUserId,
        correlationId: correlationIds[0],
        occurredAt,
        outcome: "succeeded",
        subjectId: fixture.aliceTripId,
        subjectType: "trip",
      });
      await recordAuditEvent(client.db, {
        action: "ai_action_applied",
        actorUserId: fixture.aliceUserId,
        correlationId: correlationIds[1],
        occurredAt,
        outcome: "succeeded",
        subjectId: randomUUID(),
        subjectType: "assistant_action",
      });

      const events = await client.pool.query<{
        action: string;
        expires_at: Date;
        occurred_at: Date;
      }>(
        `select action, occurred_at, expires_at
         from audit_events
         where correlation_id = any($1::uuid[])
         order by action`,
        [correlationIds],
      );
      expect(events.rows.map(({ action }) => action)).toEqual([
        "ai_action_applied",
        "resource_deleted",
      ]);
      expect(events.rows.every(({ expires_at }) => expires_at.getUTCFullYear() === 2027)).toBe(
        true,
      );

      const columns = await client.pool.query<{ column_name: string }>(`
        select column_name
        from information_schema.columns
        where table_schema = 'public' and table_name = 'audit_events'
        order by ordinal_position
      `);
      expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
        "id",
        "actor_user_id",
        "action",
        "outcome",
        "subject_type",
        "subject_id",
        "correlation_id",
        "occurred_at",
        "expires_at",
      ]);
    } finally {
      await cleanAuthorizationFixture(client, fixture, correlationIds);
      await client.close();
    }
  });

  test("resolves an allowlisted read-only trip and fails closed after expiry or revocation", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const fixture = await seedAuthorizationFixture(client);
    const correlationIds = [randomUUID(), randomUUID()];
    const dayId = randomUUID();
    const now = new Date("2026-07-28T10:00:00.000Z");
    const repository = createShareRepository(client.db);

    try {
      await client.pool.query(
        `insert into itinerary_days (id, trip_id, local_date, timezone, title, order_index)
         values ($1, $2, '2026-08-10', 'Asia/Tokyo', 'Arrival rhythm', 0)`,
        [dayId, fixture.aliceTripId],
      );
      await client.pool.query(
        `insert into itinerary_items
           (itinerary_day_id, item_type, start_time, end_time, duration_minutes,
            booking_json, source_snapshot_json, order_index)
         values ($1, 'activity', '09:00', '10:00', 60, $2::jsonb, $3::jsonb, 0)`,
        [
          dayId,
          JSON.stringify({ confirmation: "PRIVATE-42" }),
          JSON.stringify({ place: { name: "Morning walk" } }),
        ],
      );

      const created = await repository.createLink(
        fixture.aliceAuthUserId,
        fixture.aliceTripId,
        { expiresInDays: 30 },
        { correlationId: correlationIds[0], now },
      );
      await expect(
        repository.listLinks(fixture.aliceAuthUserId, fixture.aliceTripId, now),
      ).resolves.toEqual([created.link]);
      const shared = await repository.getSharedTrip(created.token, now);
      expect(shared).toMatchObject({
        title: "Alice private trip",
        days: [{ items: [{ sourceSnapshot: { place: { name: "Morning walk" } } }] }],
      });
      expect(JSON.stringify(shared)).not.toContain("PRIVATE-42");
      expect(JSON.stringify(shared)).not.toContain(fixture.aliceUserId);
      expect(JSON.stringify(shared)).not.toContain(fixture.aliceTripId);

      await expect(
        repository.getSharedTrip(created.token, new Date(now.getTime() + 31 * DAY_MS)),
      ).rejects.toBeInstanceOf(AuthorizedResourceNotFoundError);
      await repository.revokeLink(fixture.aliceAuthUserId, fixture.aliceTripId, created.link.id, {
        correlationId: correlationIds[1],
        now: new Date(now.getTime() + DAY_MS),
      });
      await expect(
        repository.getSharedTrip(created.token, new Date(now.getTime() + DAY_MS)),
      ).rejects.toBeInstanceOf(AuthorizedResourceNotFoundError);
    } finally {
      await cleanAuthorizationFixture(client, fixture, correlationIds);
      await client.close();
    }
  });
});
