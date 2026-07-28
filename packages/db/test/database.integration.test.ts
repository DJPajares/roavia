import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  getDestinationContentProvenance,
  listDestinationContentByState,
} from "../src/destination-repository.js";
import { assertSafeTestDatabaseUrl, migrateDatabase } from "../src/migrations.js";
import * as schema from "../src/schema.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describe("test database reset guard", () => {
  test("accepts only local PostgreSQL databases ending in _test", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://roavia_test:secret@127.0.0.1:55432/roavia_test"),
    ).not.toThrow();
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://user:secret@example.com/roavia_test"),
    ).toThrow("restricted to localhost");
    expect(() => assertSafeTestDatabaseUrl("postgresql://user:secret@localhost/roavia")).toThrow(
      "ending in _test",
    );
  });
});

describeDatabase("database migration baseline", () => {
  const connectionString = testDatabaseUrl!;
  const client = new Client({ connectionString });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  test("applies the initial migration to an empty database", async () => {
    const tables = await client.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `);

    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      "application_jobs",
      "destination_content",
      "destination_content_sources",
      "destination_ingestion_quarantine",
      "freshness_policies",
      "itinerary_days",
      "itinerary_items",
      "job_operator_actions",
      "offline_packages",
      "place_provider_ids",
      "places",
      "share_links",
      "sources",
      "travel_profiles",
      "trip_destinations",
      "trips",
      "users",
    ]);

    const idDefaults = await client.query<{ column_default: string; table_name: string }>(`
      select table_name, column_default
      from information_schema.columns
      where table_schema = 'public' and column_name = 'id'
      order by table_name
    `);

    expect(idDefaults.rows).toHaveLength(17);
    expect(
      idDefaults.rows.every(({ column_default }) => column_default === "gen_random_uuid()"),
    ).toBe(true);

    const tokenColumns = await client.query<{ column_name: string; data_type: string }>(`
      select column_name, data_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'share_links'
        and column_name like 'token%'
    `);
    expect(tokenColumns.rows).toEqual([{ column_name: "token_hash", data_type: "bytea" }]);
  });

  test("creates the ownership and foreign-key indexes", async () => {
    const indexes = await client.query<{ indexname: string }>(`
      select indexname
      from pg_indexes
      where schemaname = 'public'
    `);
    const names = new Set(indexes.rows.map(({ indexname }) => indexname));

    for (const expected of [
      "itinerary_days_trip_order_unique",
      "itinerary_items_day_order_unique",
      "itinerary_items_place_id_idx",
      "offline_packages_trip_id_idx",
      "offline_packages_user_generated_idx",
      "destination_content_expires_at_idx",
      "destination_content_policy_id_idx",
      "destination_content_quality_stale_idx",
      "destination_content_sources_source_id_idx",
      "destination_ingestion_quarantine_pending_seen_idx",
      "place_provider_ids_place_provider_idx",
      "places_parent_type_name_idx",
      "places_parent_place_id_idx",
      "share_links_active_trip_idx",
      "share_links_trip_id_idx",
      "travel_profiles_user_id_uidx",
      "trip_destinations_place_id_idx",
      "trip_destinations_trip_order_unique",
      "trips_origin_place_id_idx",
      "trips_owner_updated_id_idx",
    ]) {
      expect(names.has(expected), `missing index ${expected}`).toBe(true);
    }
  });

  test("traces destination content through normalized place, provider, and source records", async () => {
    await client.query("begin");
    try {
      const country = await client.query<{ id: string }>(`
        insert into places (place_type, canonical_name, country_code)
        values ('country', 'Singapore', 'SG')
        returning id
      `);
      const countryId = country.rows[0]!.id;

      const region = await client.query<{ id: string }>(
        `insert into places (parent_place_id, place_type, canonical_name, country_code)
         values ($1, 'region', 'Central Region', 'SG')
         returning id`,
        [countryId],
      );
      const regionId = region.rows[0]!.id;

      const city = await client.query<{ id: string }>(
        `insert into places (
          parent_place_id, place_type, canonical_name, localized_names_json,
          latitude, longitude, timezone, country_code
        ) values ($1, 'city', 'Singapore', '{"zh":"新加坡"}', 1.3521, 103.8198, 'Asia/Singapore', 'SG')
        returning id`,
        [regionId],
      );
      const cityId = city.rows[0]!.id;

      const poi = await client.query<{ id: string }>(
        `insert into places (
          parent_place_id, place_type, canonical_name, latitude, longitude,
          timezone, country_code
        ) values ($1, 'poi', 'Gardens by the Bay', 1.2816, 103.8636,
          'Asia/Singapore', 'SG')
        returning id`,
        [cityId],
      );
      const poiId = poi.rows[0]!.id;

      const hierarchy = await client.query<{ place_type: string }>(
        `with recursive place_ancestors as (
          select id, parent_place_id, place_type, 0 as depth
          from places
          where id = $1
          union all
          select parent.id, parent.parent_place_id, parent.place_type, child.depth + 1
          from places parent
          join place_ancestors child on child.parent_place_id = parent.id
        )
        select place_type from place_ancestors order by depth`,
        [poiId],
      );
      expect(hierarchy.rows.map(({ place_type }) => place_type)).toEqual([
        "poi",
        "city",
        "region",
        "country",
      ]);

      await client.query(
        `insert into place_provider_ids (place_id, provider, provider_place_id)
         values ($1, 'fsq-os-places', 'fsq-singapore-city')`,
        [cityId],
      );

      const policy = await client.query<{ id: string }>(`
        insert into freshness_policies (
          policy_key, version, fresh_for_seconds, expire_after_seconds,
          manual_review_after_seconds, description
        ) values ('destination.editorial', 1, 86400, 604800, 31536000,
          'Editorial content is fresh for one day and expires after seven days in this fixture.')
        returning id
      `);
      const policyId = policy.rows[0]!.id;

      const source = await client.query<{ id: string }>(`
        insert into sources (
          provider, source_url, title, source_kind, license, license_url,
          attribution_text, offline_use_allowed, redistribution_allowed,
          retrieved_at, trust_tier
        ) values (
          'visitsingapore', 'https://www.visitsingapore.com/', 'Visit Singapore',
          'official_authority', 'official-site-terms', 'https://www.visitsingapore.com/terms-of-use/',
          'Source: Visit Singapore', false, false,
          '2026-07-28T00:00:00Z', 'tier_1'
        ) returning id
      `);
      const sourceId = source.rows[0]!.id;

      const contentRows = await client.query<{ content_type: string; id: string }>(
        `insert into destination_content (
          place_id, freshness_policy_id, content_type, locale, content_json,
          quality_state, refreshed_at, stale_at, expires_at, reviewed_at, reviewed_by
        ) values
          ($1, $2, 'overview', 'en', '{"summary":"A source-aware city overview."}',
            'approved', '2026-07-28T00:00:00Z', '2026-07-29T00:00:00Z',
            '2026-08-04T00:00:00Z', '2026-07-28T01:00:00Z', 'editor@example.test'),
          ($1, $2, 'transport', 'en', '{"summary":"A stale transport fixture."}',
            'draft', '2026-07-20T00:00:00Z', '2026-07-21T00:00:00Z',
            '2026-08-01T00:00:00Z', null, null),
          ($1, $2, 'events', 'en', '{"summary":"An expired event fixture."}',
            'draft', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z',
            '2026-07-03T00:00:00Z', null, null)
        returning id, content_type`,
        [cityId, policyId],
      );
      const contentByType = new Map(
        contentRows.rows.map(({ content_type, id }) => [content_type, id]),
      );
      const overviewId = contentByType.get("overview")!;

      await client.query(
        `insert into destination_content_sources (
          destination_content_id, source_id, source_role, retrieved_at
        ) values ($1, $2, 'primary', '2026-07-28T00:00:00Z')`,
        [overviewId, sourceId],
      );

      const db = drizzle({ client, schema });
      const now = new Date("2026-07-28T12:00:00Z");
      const provenance = await getDestinationContentProvenance(db, overviewId, now);

      expect(provenance).toMatchObject({
        id: overviewId,
        place: { id: cityId, canonicalName: "Singapore", type: "city" },
        contentType: "overview",
        qualityState: "approved",
        freshnessState: "fresh",
        reviewedBy: "editor@example.test",
        sources: [
          {
            id: sourceId,
            role: "primary",
            provider: "visitsingapore",
            kind: "official_authority",
            trustTier: "tier_1",
            url: "https://www.visitsingapore.com/",
          },
        ],
      });

      const providerIdentity = await client.query<{
        place_id: string;
        provider_place_id: string;
      }>(
        `select place_id, provider_place_id
         from place_provider_ids
         where provider = 'fsq-os-places' and provider_place_id = 'fsq-singapore-city'`,
      );
      expect(providerIdentity.rows).toEqual([
        { place_id: cityId, provider_place_id: "fsq-singapore-city" },
      ]);
      expect(providerIdentity.rows[0]?.provider_place_id).not.toBe(cityId);

      const fresh = await listDestinationContentByState(db, "fresh", { now });
      const stale = await listDestinationContentByState(db, "stale", { now });
      const expired = await listDestinationContentByState(db, "expired", { now });
      const manuallyReviewed = await listDestinationContentByState(db, "manually_reviewed", {
        now,
      });

      expect(fresh.map(({ contentType }) => contentType)).toContain("overview");
      expect(stale.map(({ contentType }) => contentType)).toContain("transport");
      expect(expired.map(({ contentType }) => contentType)).toContain("events");
      expect(manuallyReviewed.map(({ contentType }) => contentType)).toContain("overview");
    } finally {
      await client.query("rollback");
    }
  });

  test("installs the pinned pg-boss schema through the migration gate", async () => {
    const version = await client.query<{ version: number }>(
      "select version from jobs.version order by version desc limit 1",
    );
    expect(version.rows).toEqual([{ version: 37 }]);

    const tables = await client.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'jobs' and table_type = 'BASE TABLE'
      order by table_name
    `);
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining(["job", "job_common", "queue", "schedule", "version"]),
    );
  });

  test("enforces ownership, checks, and cascade behavior", async () => {
    await client.query("begin");
    try {
      const user = await client.query<{ id: string }>(`
        insert into users (auth_user_id, display_name)
        values ('auth-test-user', 'Test User')
        returning id
      `);
      const userId = user.rows[0]!.id;

      await client.query("insert into travel_profiles (user_id) values ($1)", [userId]);

      const place = await client.query<{ id: string }>(`
        insert into places (place_type, canonical_name, country_code)
        values ('city', 'Singapore', 'SG')
        returning id
      `);
      const placeId = place.rows[0]!.id;

      const trip = await client.query<{ id: string }>(
        `insert into trips (
          owner_user_id, title, slug, origin_place_id, start_date, end_date
        ) values ($1, 'Singapore', 'singapore', $2, '2026-08-01', '2026-08-03')
        returning id`,
        [userId, placeId],
      );
      const tripId = trip.rows[0]!.id;

      await client.query(
        "insert into trip_destinations (trip_id, place_id, order_index) values ($1, $2, 0)",
        [tripId, placeId],
      );

      const day = await client.query<{ id: string }>(
        `insert into itinerary_days (trip_id, local_date, timezone, order_index)
         values ($1, '2026-08-01', 'Asia/Singapore', 0)
         returning id`,
        [tripId],
      );

      await client.query(
        `insert into itinerary_items (
          itinerary_day_id, place_id, item_type, start_time, end_time, order_index
        ) values ($1, $2, 'activity', '09:00', '10:00', 0)`,
        [day.rows[0]!.id, placeId],
      );

      await client.query(
        "insert into share_links (trip_id, token_hash) values ($1, decode(repeat('aa', 32), 'hex'))",
        [tripId],
      );
      await client.query(
        `insert into offline_packages (user_id, trip_id, version, manifest_json, size_bytes)
         values ($1, $2, 1, '{}', 128)`,
        [userId, tripId],
      );

      await client.query("savepoint invalid_trip");
      await expect(
        client.query(
          `insert into trips (owner_user_id, title, slug, start_date, end_date)
           values ($1, 'Invalid', 'invalid-dates', '2026-08-03', '2026-08-01')`,
          [userId],
        ),
      ).rejects.toMatchObject({ constraint: "trips_date_order_chk" });
      await client.query("rollback to savepoint invalid_trip");

      await client.query("delete from users where id = $1", [userId]);

      const ownedRows = await client.query<{ count: string }>(
        `select sum(row_count)::text as count
         from (
           select count(*) as row_count from travel_profiles where user_id = $1
           union all select count(*) from trips where owner_user_id = $1
           union all select count(*) from trip_destinations where trip_id = $2
           union all select count(*) from itinerary_days where trip_id = $2
           union all select count(*) from itinerary_items where itinerary_day_id = $3
           union all select count(*) from share_links where trip_id = $2
           union all select count(*) from offline_packages where user_id = $1
         ) counts`,
        [userId, tripId, day.rows[0]!.id],
      );
      expect(ownedRows.rows[0]?.count).toBe("0");

      const retainedPlace = await client.query<{ count: string }>(
        "select count(*) from places where id = $1",
        [placeId],
      );
      expect(retainedPlace.rows[0]?.count).toBe("1");
    } finally {
      await client.query("rollback");
    }
  });

  test("migration runner is idempotent", async () => {
    await migrateDatabase(connectionString);
    const result = await client.query<{ count: string }>(
      "select count(*) from information_schema.tables where table_schema = 'public'",
    );
    expect(Number(result.rows[0]?.count)).toBeGreaterThanOrEqual(12);
  });
});
