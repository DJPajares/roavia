import { destinationSearchQuerySchema } from "@roavia/contracts";
import { describe, expect, test } from "vitest";

import { createDatabaseClient } from "../src/client.js";
import { searchDestinations } from "../src/destination-repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

async function cleanFixtureData(client: ReturnType<typeof createDatabaseClient>) {
  await client.pool.query(
    "delete from places where canonical_name in ('Searchland', 'Search Region', 'Search City', 'Search Garden')",
  );
}

async function seedSearchFixture(client: ReturnType<typeof createDatabaseClient>) {
  await client.pool.query(`
    insert into places (id, parent_place_id, place_type, canonical_name, localized_names_json, country_code)
    values
      ('11111111-1111-4111-8111-111111111111', null, 'country', 'Searchland', '{}', 'SL'),
      ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'region', 'Search Region', '{}', 'SL'),
      ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'city', 'Search City', '{"zh":"搜索城"}', 'SL'),
      ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'poi', 'Search Garden', '{}', 'SL')
  `);
}

describeDatabase("destination search repository", () => {
  test("ranks canonical and localized names, filters hierarchy, and paginates without providers", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    await cleanFixtureData(client);

    try {
      await seedSearchFixture(client);

      const firstPage = await searchDestinations(
        client.db,
        destinationSearchQuerySchema.parse({ query: "Search", limit: 1 }),
      );
      expect(firstPage.pagination).toEqual({ page: 1, limit: 1, total: 4, nextPage: 2 });
      expect(firstPage.results).toHaveLength(1);

      const secondPage = await searchDestinations(
        client.db,
        destinationSearchQuerySchema.parse({ query: "Search", page: 2, limit: 1 }),
      );
      expect(secondPage.results).toHaveLength(1);
      expect(firstPage.results[0]?.id).not.toBe(secondPage.results[0]?.id);

      const localized = await searchDestinations(
        client.db,
        destinationSearchQuerySchema.parse({ query: "搜索城", types: ["city"] }),
      );
      expect(localized.results).toEqual([
        expect.objectContaining({
          canonicalName: "Search City",
          localizedNames: { zh: "搜索城" },
          placeType: "city",
        }),
      ]);
      expect(localized.results[0]?.hierarchy.map((item) => item.name)).toEqual([
        "Searchland",
        "Search Region",
      ]);
      expect(JSON.stringify(localized.results[0])).not.toContain("provider");

      const regionId = localized.results[0]?.hierarchy[1]?.id;
      const filtered = await searchDestinations(
        client.db,
        destinationSearchQuerySchema.parse({
          query: "Garden",
          country: "SL",
          regionId,
          types: ["poi"],
        }),
      );
      expect(filtered.results).toEqual([
        expect.objectContaining({ canonicalName: "Search Garden", placeType: "poi" }),
      ]);
    } finally {
      await cleanFixtureData(client);
      await client.close();
    }
  });
});
