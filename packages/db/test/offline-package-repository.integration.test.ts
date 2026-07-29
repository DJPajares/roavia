import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import { AuthorizedResourceNotFoundError } from "../src/authorization.js";
import { createDatabaseClient } from "../src/client.js";
import { createOfflinePackageRepository } from "../src/offline-package-repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("offline package repository", () => {
  test("generates owner-scoped deterministic versions and excludes unlicensed content", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    const ids = {
      aliceAuth: randomUUID(),
      aliceUser: randomUUID(),
      allowedContent: randomUUID(),
      allowedSource: randomUUID(),
      bobAuth: randomUUID(),
      bobUser: randomUUID(),
      day: randomUUID(),
      destination: randomUUID(),
      item: randomUUID(),
      place: randomUUID(),
      policy: randomUUID(),
      restrictedContent: randomUUID(),
      restrictedSource: randomUUID(),
      trip: randomUUID(),
    };
    const repository = createOfflinePackageRepository(client.db);

    try {
      await client.pool.query(
        `insert into users (id, auth_user_id, display_name)
         values ($1, $2, 'Offline Alice'), ($3, $4, 'Offline Bob')`,
        [ids.aliceUser, ids.aliceAuth, ids.bobUser, ids.bobAuth],
      );
      await client.pool.query(
        `insert into places
          (id, place_type, canonical_name, latitude, longitude, timezone, country_code)
         values ($1, 'city', 'Tokyo offline fixture', 35.676200, 139.650300, 'Asia/Tokyo', 'JP')`,
        [ids.place],
      );
      await client.pool.query(
        `insert into freshness_policies
          (id, policy_key, version, fresh_for_seconds, expire_after_seconds, description)
         values ($1, $2, 1, 86400, 604800, 'Offline package test policy')`,
        [ids.policy, `offline.test.${ids.trip}`],
      );
      await client.pool.query(
        `insert into sources
          (id, provider, source_url, title, source_kind, license, attribution_text,
           offline_use_allowed, redistribution_allowed, retrieved_at, trust_tier)
         values
          ($1, 'offline-test', $2, 'Official emergency source', 'official_authority',
           'open-data', 'Official emergency authority', true, true,
           '2026-07-28T00:00:00.000Z', 'tier_1'),
          ($3, 'offline-test', $4, 'Restricted media source', 'licensed_provider',
           'display-only', 'Restricted media', false, false,
           '2026-07-28T00:00:00.000Z', 'tier_3')`,
        [
          ids.allowedSource,
          `https://example.com/${ids.allowedSource}`,
          ids.restrictedSource,
          `https://example.com/${ids.restrictedSource}`,
        ],
      );
      await client.pool.query(
        `insert into destination_content
          (id, place_id, freshness_policy_id, content_type, locale, content_json,
           quality_state, refreshed_at, stale_at, expires_at)
         values
          ($1, $2, $3, 'emergency', 'en', '{"emergencyNumber":"110"}', 'approved',
           '2026-07-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2027-07-28T00:00:00.000Z'),
          ($4, $2, $3, 'media', 'en', '{"asset":"restricted"}', 'approved',
           '2026-07-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2027-07-28T00:00:00.000Z')`,
        [ids.allowedContent, ids.place, ids.policy, ids.restrictedContent],
      );
      await client.pool.query(
        `insert into destination_content_sources
          (destination_content_id, source_id, source_role, retrieved_at)
         values
          ($1, $2, 'primary', '2026-07-28T00:00:00.000Z'),
          ($3, $4, 'primary', '2026-07-28T00:00:00.000Z')`,
        [ids.allowedContent, ids.allowedSource, ids.restrictedContent, ids.restrictedSource],
      );
      await client.pool.query(
        `insert into trips
          (id, owner_user_id, title, slug, start_date, end_date, traveler_summary_json,
           budget_json, status, generation_state, revision)
         values ($1, $2, 'Offline Tokyo', $3, '2026-10-01', '2026-10-06',
           '{"adults":2,"children":0,"infants":0}',
           '{"amountMinor":200000,"currency":"JPY","style":"midrange"}',
           'active', 'ready', 1)`,
        [ids.trip, ids.aliceUser, `offline-${ids.trip}`],
      );
      await client.pool.query(
        `insert into trip_destinations (id, trip_id, place_id, order_index)
         values ($1, $2, $3, 0)`,
        [ids.destination, ids.trip, ids.place],
      );
      await client.pool.query(
        `insert into itinerary_days
          (id, trip_id, local_date, timezone, title, notes, order_index)
         values ($1, $2, '2026-10-02', 'Asia/Tokyo', 'Arrival', 'Emergency card packed', 0)`,
        [ids.day, ids.trip],
      );
      await client.pool.query(
        `insert into itinerary_items
          (id, itinerary_day_id, place_id, item_type, start_time, end_time,
           duration_minutes, source_snapshot_json, notes, order_index)
         values ($1, $2, $3, 'activity', '09:00', '10:00', 60,
           '{"address":"1 Offline Street"}', 'Original note', 0)`,
        [ids.item, ids.day, ids.place],
      );

      const first = await repository.generate(ids.aliceAuth, ids.trip, {
        now: new Date("2026-07-29T12:00:00.000Z"),
      });
      const duplicate = await repository.generate(ids.aliceAuth, ids.trip, {
        now: new Date("2026-07-30T12:00:00.000Z"),
      });

      expect(first.reused).toBe(false);
      expect(duplicate).toMatchObject({
        package: { id: first.package.id, version: 1 },
        reused: true,
      });
      expect(first.package.manifest.guidance).toHaveLength(1);
      expect(first.package.manifest.guidance[0]).toMatchObject({ contentType: "emergency" });
      expect(first.package.manifest.licensing.excludedContent).toEqual([
        {
          contentType: "media",
          placeId: ids.place,
          reason: "offline_redistribution_not_permitted",
        },
      ]);
      expect(first.package.manifest.trip.days[0]?.items[0]?.place).toMatchObject({
        address: "1 Offline Street",
      });

      await client.pool.query("update itinerary_items set notes = 'Changed note' where id = $1", [
        ids.item,
      ]);
      await client.pool.query("update trips set revision = 2 where id = $1", [ids.trip]);
      const changed = await repository.generate(ids.aliceAuth, ids.trip, {
        now: new Date("2026-07-31T12:00:00.000Z"),
      });

      expect(changed).toMatchObject({ package: { version: 2 }, reused: false });
      expect(changed.package.manifest.contentHash).not.toBe(first.package.manifest.contentHash);
      await expect(repository.generate(ids.bobAuth, ids.trip)).rejects.toBeInstanceOf(
        AuthorizedResourceNotFoundError,
      );
      await expect(repository.getLatest(ids.bobAuth, ids.trip)).resolves.toBeNull();
      await expect(repository.getLatest(ids.aliceAuth, ids.trip)).resolves.toMatchObject({
        version: 2,
      });
    } finally {
      await client.pool.query("delete from users where id = any($1::uuid[])", [
        [ids.aliceUser, ids.bobUser],
      ]);
      await client.pool.query("delete from places where id = $1", [ids.place]);
      await client.pool.query("delete from sources where id = any($1::uuid[])", [
        [ids.allowedSource, ids.restrictedSource],
      ]);
      await client.pool.query("delete from freshness_policies where id = $1", [ids.policy]);
      await client.close();
    }
  });
});
