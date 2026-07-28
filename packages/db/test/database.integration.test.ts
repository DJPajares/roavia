import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  assertSafeTestDatabaseUrl,
  migrateDatabase,
  resetAndMigrateTestDatabase,
} from "../src/migrations.js";

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
    await resetAndMigrateTestDatabase(connectionString);
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
      "itinerary_days",
      "itinerary_items",
      "offline_packages",
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

    expect(idDefaults.rows).toHaveLength(10);
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

  test("is idempotent and resets back to an empty migrated database", async () => {
    await migrateDatabase(connectionString);
    await client.query(
      "insert into sources (provider, source_url) values ('test', 'https://example.com')",
    );

    await resetAndMigrateTestDatabase(connectionString);

    const result = await client.query<{ count: string }>("select count(*) from sources");
    expect(result.rows[0]?.count).toBe("0");
  });
});
