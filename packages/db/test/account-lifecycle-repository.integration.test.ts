import { createHash, randomUUID } from "node:crypto";

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, test } from "vitest";

import {
  AccountExportUnavailableError,
  createAccountLifecycleRepository,
} from "../src/account-lifecycle-repository.js";
import { createDatabaseClient } from "../src/client.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const secret = "account-lifecycle-test-secret-32-characters";
const now = new Date("2026-08-02T00:00:00.000Z");

describeDatabase("account lifecycle repository", () => {
  test("exports an isolated checksummed snapshot and executes idempotent deletion", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const repository = createAccountLifecycleRepository(client.db);
    const ids = {
      action: randomUUID(),
      aliceAuth: `account-alice-${randomUUID()}`,
      aliceUser: randomUUID(),
      bobAuth: `account-bob-${randomUUID()}`,
      bobTrip: randomUUID(),
      bobUser: randomUUID(),
      day: randomUUID(),
      item: randomUUID(),
      offline: randomUUID(),
      share: randomUUID(),
      trip: randomUUID(),
    };
    const correlationIds = Array.from({ length: 3 }, () => randomUUID());
    let receiptId: string | undefined;

    try {
      await client.pool.query(
        `insert into users (id, auth_user_id, display_name, home_country)
         values ($1, $2, 'Alice Export', 'SG'), ($3, $4, 'Bob Private', 'US')`,
        [ids.aliceUser, ids.aliceAuth, ids.bobUser, ids.bobAuth],
      );
      await client.pool.query(
        `insert into travel_profiles (user_id, interests_json, dietary_needs_json)
         values ($1, '["food"]', '["vegetarian"]')`,
        [ids.aliceUser],
      );
      await client.pool.query(
        `insert into trips
          (id, owner_user_id, title, slug, start_date, end_date, traveler_summary_json)
         values
          ($1, $2, 'Alice Kyoto', $3, '2026-10-01', '2026-10-05', '{"adults":1}'),
          ($4, $5, 'BOB-SECRET-TRIP', $6, '2026-11-01', '2026-11-05', '{"adults":1}')`,
        [
          ids.trip,
          ids.aliceUser,
          `alice-export-${ids.trip}`,
          ids.bobTrip,
          ids.bobUser,
          `bob-private-${ids.bobTrip}`,
        ],
      );
      await client.pool.query(
        `insert into itinerary_days (id, trip_id, local_date, timezone, title, order_index)
         values ($1, $2, '2026-10-02', 'Asia/Tokyo', 'Markets', 0)`,
        [ids.day, ids.trip],
      );
      await client.pool.query(
        `insert into itinerary_items
          (id, itinerary_day_id, item_type, notes, source_snapshot_json, order_index)
         values ($1, $2, 'note', 'Alice itinerary note', '{"source":"saved citation"}', 0)`,
        [ids.item, ids.day],
      );
      await client.pool.query(
        `insert into share_links
          (id, trip_id, token_hash, expires_at, created_at)
         values ($1, $2, $3, $4, $5)`,
        [ids.share, ids.trip, Buffer.alloc(32, 1), new Date(now.getTime() + 86_400_000), now],
      );
      await client.pool.query(
        `insert into offline_packages
          (id, user_id, trip_id, version, manifest_json, generated_at, size_bytes)
         values ($1, $2, $3, 1, '{"schemaVersion":1,"contentHash":"abc123"}', $4, 128)`,
        [ids.offline, ids.aliceUser, ids.trip, now],
      );
      await client.pool.query(
        `insert into assistant_actions
          (id, owner_user_id, trip_id, trip_revision, kind, payload_json, correlation_id,
           expires_at, created_at, updated_at)
         values ($1, $2, $3, 1, 'save_note', '{"note":"Alice assistant note"}', $4,
           $5, $6, $6)`,
        [
          ids.action,
          ids.aliceUser,
          ids.trip,
          randomUUID(),
          new Date(now.getTime() + 12 * 3_600_000),
          now,
        ],
      );

      const preview = await repository.previewDeletion(ids.aliceAuth, now);
      expect(preview).toMatchObject({
        assistantRecords: 1,
        offlinePackages: 1,
        shareLinks: 1,
        trips: 1,
      });

      const grant = await repository.createExport(
        { authUserId: ids.aliceAuth, email: "alice@roavia.test" },
        secret,
        { correlationId: correlationIds[0], now },
      );
      expect(grant.expiresAt.getTime() - grant.createdAt.getTime()).toBe(23 * 3_600_000);
      await expect(
        repository.downloadExport(ids.bobAuth, grant.exportId, grant.grantToken, secret, { now }),
      ).rejects.toBeInstanceOf(AccountExportUnavailableError);
      await expect(
        repository.downloadExport(ids.aliceAuth, grant.exportId, "wrong-grant", secret, { now }),
      ).rejects.toBeInstanceOf(AccountExportUnavailableError);

      const artifact = await repository.downloadExport(
        ids.aliceAuth,
        grant.exportId,
        grant.grantToken,
        secret,
        { correlationId: correlationIds[1], now },
      );
      const archive = unzipSync(artifact.bytes);
      const textFiles = Object.fromEntries(
        Object.entries(archive).map(([path, bytes]) => [path, strFromU8(bytes)]),
      );
      const manifest = JSON.parse(textFiles["manifest.json"]!) as {
        files: { path: string; sha256: string; sizeBytes: number }[];
        recordCounts: Record<string, number>;
        schemaVersion: number;
      };
      expect(manifest).toMatchObject({
        recordCounts: {
          assistantActions: 1,
          itineraryDays: 1,
          itineraryItems: 1,
          offlinePackages: 1,
          shareLinks: 1,
          trips: 1,
        },
        schemaVersion: 1,
      });
      for (const file of manifest.files) {
        const contents = textFiles[file.path]!;
        expect(Buffer.byteLength(contents)).toBe(file.sizeBytes);
        expect(createHash("sha256").update(contents).digest("hex")).toBe(file.sha256);
      }
      const exportedText = Object.values(textFiles).join("\n");
      expect(exportedText).toContain("Alice Kyoto");
      expect(exportedText).toContain("alice@roavia.test");
      expect(exportedText).not.toContain("BOB-SECRET-TRIP");
      expect(exportedText).not.toContain(ids.aliceAuth);
      expect(exportedText).not.toContain(grant.grantToken);
      expect(archive[`itinerary/${ids.trip}.json`]).toBeDefined();

      const first = await repository.beginDeletion(ids.aliceAuth, secret, {
        correlationId: correlationIds[2],
        now,
      });
      receiptId = first.receiptId;
      const repeated = await repository.beginDeletion(ids.aliceAuth, secret, { now });
      expect(repeated.receiptId).toBe(first.receiptId);
      await expect(
        repository.downloadExport(ids.aliceAuth, grant.exportId, grant.grantToken, secret, { now }),
      ).rejects.toBeInstanceOf(AccountExportUnavailableError);
      const revoked = await client.pool.query<{ revoked_at: Date | null }>(
        "select revoked_at from share_links where id = $1",
        [ids.share],
      );
      expect(revoked.rows[0]?.revoked_at).toEqual(now);

      await repository.purgeAccount(ids.aliceAuth, first.receiptId, now);
      for (const step of [
        "sessionRevocation",
        "jobCancellation",
        "liveDataDeletion",
        "authIdentityDeletion",
      ] as const) {
        await repository.markDeletionStep(first.receiptId, step, "succeeded", { now });
      }
      const completed = await repository.findDeletion(ids.aliceAuth, secret);
      expect(completed).toMatchObject({ receiptId: first.receiptId, status: "completed" });
      expect(JSON.stringify(completed)).not.toContain(ids.aliceAuth);
      expect(JSON.stringify(completed)).not.toContain("alice@roavia.test");
      const users = await client.pool.query("select id from users where id = $1", [ids.aliceUser]);
      const bob = await client.pool.query("select id from users where id = $1", [ids.bobUser]);
      expect(users.rowCount).toBe(0);
      expect(bob.rowCount).toBe(1);
    } finally {
      await client.pool.query("delete from audit_events where correlation_id = any($1::uuid[])", [
        correlationIds,
      ]);
      if (receiptId) {
        await client.pool.query("delete from audit_events where subject_id = $1", [receiptId]);
        await client.pool.query("delete from account_deletion_receipts where id = $1", [receiptId]);
      }
      await client.pool.query("delete from users where id = any($1::uuid[])", [
        [ids.aliceUser, ids.bobUser],
      ]);
      await client.close();
    }
  });

  test("returns an empty preview and provisions first-use account exports", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const repository = createAccountLifecycleRepository(client.db);
    const authUserId = `account-first-use-${randomUUID()}`;
    let exportId: string | undefined;
    let userId: string | undefined;

    try {
      await expect(repository.previewDeletion(authUserId, now)).resolves.toMatchObject({
        assistantRecords: 0,
        trips: 0,
      });
      const grant = await repository.createExport(
        { authUserId, email: "first.use@roavia.test" },
        secret,
        { now },
      );
      exportId = grant.exportId;
      const account = await client.pool.query<{ id: string }>(
        "select id from users where auth_user_id = $1",
        [authUserId],
      );
      userId = account.rows[0]?.id;
      expect(userId).toBeDefined();
      await expect(
        repository.downloadExport(authUserId, grant.exportId, grant.grantToken, secret, {
          now: new Date(now.getTime() + 24 * 3_600_000),
        }),
      ).rejects.toBeInstanceOf(AccountExportUnavailableError);
    } finally {
      if (exportId)
        await client.pool.query("delete from audit_events where subject_id = $1", [exportId]);
      if (userId) await client.pool.query("delete from users where id = $1", [userId]);
      await client.close();
    }
  });
});
