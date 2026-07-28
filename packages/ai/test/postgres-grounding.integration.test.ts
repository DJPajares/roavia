import { describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  ingestDestinationCatalog,
  mvpLaunchDestinationCatalog,
} from "@roavia/db";

import { GroundingRetriever } from "../src/index.js";
import { PostgresGroundingDataSource } from "../src/server/index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

async function cleanFixtureData(client: ReturnType<typeof createDatabaseClient>) {
  await client.pool.query(`
    delete from places
    where id in (
      select place_id from place_provider_ids where provider = 'roavia-curated'
    )
  `);
  await client.pool.query(
    "delete from sources where provider in ('visitsingapore', 'roavia') and metadata_json->>'fixture' = 'true'",
  );
  await client.pool.query(
    "delete from freshness_policies where policy_key in ('destination.editorial', 'destination.media')",
  );
  await client.pool.query(
    "delete from destination_ingestion_quarantine where provider = 'roavia-curated'",
  );
}

describeDatabase("PostgreSQL grounding integration", () => {
  test("retrieves approved city and descendant content with source traceability", async () => {
    const client = createDatabaseClient(testDatabaseUrl!);
    await cleanFixtureData(client);

    try {
      const now = new Date("2026-07-28T08:00:00.000Z");
      await ingestDestinationCatalog(client.db, mvpLaunchDestinationCatalog, {
        mode: "seed",
        now,
      });
      await client.pool.query(`
        update destination_content content
        set quality_state = 'approved',
            reviewed_at = '2026-07-28T08:30:00.000Z',
            reviewed_by = 'grounding-reviewer@example.test'
        where content.content_type <> 'media'
          and exists (
            select 1 from place_provider_ids identity
            where identity.place_id = content.place_id
              and identity.provider = 'roavia-curated'
          )
      `);
      const city = await client.pool.query<{ id: string }>(`
        select place_id as id
        from place_provider_ids
        where provider = 'roavia-curated'
          and provider_place_id = 'sg-singapore-city'
      `);
      const cityId = city.rows[0]!.id;
      const retriever = new GroundingRetriever([
        new PostgresGroundingDataSource(client.db, { maxDepth: 2 }),
      ]);

      const context = await retriever.retrieve(
        {
          destinationIds: [cityId],
          purpose: "itinerary",
          query: "Singapore Gardens by the Bay practical guidance",
          requiredKinds: ["place", "practical"],
        },
        now,
      );

      expect(context.status).toBe("complete");
      expect(context.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "place", title: "Singapore — overview" }),
          expect.objectContaining({ kind: "practical", title: "Gardens by the Bay — practical" }),
        ]),
      );
      expect(context.sources).toEqual([
        expect.objectContaining({
          official: true,
          provider: "visitsingapore",
          trustTier: "tier_1",
          url: "https://www.visitsingapore.com/",
        }),
      ]);
      expect(
        context.items.every((item) => item.sourceIds[0] === context.sources[0]?.sourceId),
      ).toBe(true);
      expect(context.renderedContext).toContain("officialUrl");
      expect(context.renderedContext).not.toContain("publicationState");
      expect(context.renderedContext).not.toContain("media");
    } finally {
      await cleanFixtureData(client);
      await client.close();
    }
  });
});
