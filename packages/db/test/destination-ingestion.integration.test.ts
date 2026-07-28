import { describe, expect, test } from "vitest";

import { createDatabaseClient } from "../src/client.js";
import { ingestDestinationCatalog } from "../src/destination-ingestion.js";
import { getDestinationContentProvenance } from "../src/destination-repository.js";
import { mvpLaunchDestinationCatalog } from "../src/fixtures/mvp-launch-destinations.js";

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

describeDatabase("curated destination ingestion", () => {
  const connectionString = testDatabaseUrl!;

  test("reruns idempotently, preserves reviewed content, and quarantines invalid records", async () => {
    const client = createDatabaseClient(connectionString);
    await cleanFixtureData(client);

    try {
      const now = new Date("2026-07-28T08:00:00.000Z");
      const first = await ingestDestinationCatalog(client.db, mvpLaunchDestinationCatalog, {
        mode: "seed",
        now,
      });
      expect(first).toMatchObject({
        contentCreated: 3,
        placesCreated: 4,
        policiesUpserted: 2,
        recordsQuarantined: 0,
        recordsReceived: 8,
        sourcesUpserted: 2,
      });

      const second = await ingestDestinationCatalog(client.db, mvpLaunchDestinationCatalog, {
        mode: "seed",
        now,
      });
      expect(second).toMatchObject({
        contentCreated: 0,
        contentUpdated: 3,
        placesCreated: 0,
        placesUpdated: 4,
        recordsQuarantined: 0,
      });

      const hierarchy = await client.pool.query<{ canonical_name: string; place_type: string }>(`
        with recursive place_ancestors as (
          select p.id, p.parent_place_id, p.place_type, p.canonical_name, 0 as depth
          from places p
          join place_provider_ids identity on identity.place_id = p.id
          where identity.provider = 'roavia-curated'
            and identity.provider_place_id = 'sg-gardens-by-the-bay'
          union all
          select parent.id, parent.parent_place_id, parent.place_type,
            parent.canonical_name, child.depth + 1
          from places parent
          join place_ancestors child on child.parent_place_id = parent.id
        )
        select canonical_name, place_type from place_ancestors order by depth
      `);
      expect(hierarchy.rows).toEqual([
        { canonical_name: "Gardens by the Bay", place_type: "poi" },
        { canonical_name: "Singapore", place_type: "city" },
        { canonical_name: "Central Region", place_type: "region" },
        { canonical_name: "Singapore", place_type: "country" },
      ]);

      const overview = await client.pool.query<{ id: string }>(`
        select content.id
        from destination_content content
        join place_provider_ids identity on identity.place_id = content.place_id
        where identity.provider = 'roavia-curated'
          and identity.provider_place_id = 'sg-singapore-city'
          and content.content_type = 'overview'
      `);
      const overviewId = overview.rows[0]!.id;
      const provenance = await getDestinationContentProvenance(client.db, overviewId, now);
      expect(provenance).toMatchObject({
        contentType: "overview",
        freshnessState: "fresh",
        place: { canonicalName: "Singapore", type: "city" },
        sources: [
          {
            attributionText: "Source: Visit Singapore",
            kind: "official_authority",
            provider: "visitsingapore",
            trustTier: "tier_1",
            url: "https://www.visitsingapore.com/",
          },
        ],
      });

      const media = await client.pool.query<{
        content_json: { assets: Array<{ license: string; publishable: boolean }> };
      }>(`
        select content.content_json
        from destination_content content
        join place_provider_ids identity on identity.place_id = content.place_id
        where identity.provider = 'roavia-curated'
          and identity.provider_place_id = 'sg-singapore-city'
          and content.content_type = 'media'
      `);
      expect(media.rows[0]?.content_json.assets).toEqual([
        expect.objectContaining({ license: "roavia-internal-fixture", publishable: false }),
      ]);

      await client.pool.query(
        `update destination_content
         set content_json = '{"summary":"Human-reviewed override"}',
             quality_state = 'approved',
             reviewed_at = '2026-07-28T09:00:00.000Z',
             reviewed_by = 'editor@example.test'
         where id = $1`,
        [overviewId],
      );

      const refreshed = await ingestDestinationCatalog(client.db, mvpLaunchDestinationCatalog, {
        mode: "refresh",
        now: new Date("2026-07-29T08:00:00.000Z"),
      });
      expect(refreshed.reviewedContentPreserved).toBe(1);
      const preserved = await client.pool.query<{
        content_json: { summary: string };
        reviewed_by: string;
      }>("select content_json, reviewed_by from destination_content where id = $1", [overviewId]);
      expect(preserved.rows[0]).toEqual({
        content_json: { summary: "Human-reviewed override" },
        reviewed_by: "editor@example.test",
      });

      const invalidCatalog = {
        ...mvpLaunchDestinationCatalog,
        records: [
          ...mvpLaunchDestinationCatalog.records,
          {
            kind: "place",
            key: "invalid-city",
            canonicalName: "",
            placeType: "city",
            parentKey: "sg",
          },
        ],
      };
      const invalid = await ingestDestinationCatalog(client.db, invalidCatalog, {
        mode: "refresh",
      });
      expect(invalid.recordsQuarantined).toBe(1);

      const quarantine = await client.pool.query<{
        errors_json: Array<{ path: string }>;
        occurrence_count: number;
        status: string;
      }>(`
        select errors_json, occurrence_count, status
        from destination_ingestion_quarantine
        where provider = 'roavia-curated' and provider_record_id = 'place:invalid-city'
      `);
      expect(quarantine.rows[0]).toMatchObject({ occurrence_count: 1, status: "pending" });
      expect(quarantine.rows[0]?.errors_json).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "canonicalName" })]),
      );

      const correctedCatalog = {
        ...mvpLaunchDestinationCatalog,
        records: [
          ...mvpLaunchDestinationCatalog.records,
          {
            kind: "place",
            key: "invalid-city",
            canonicalName: "Corrected City",
            placeType: "city",
            parentKey: "sg",
            countryCode: "SG",
            timezone: "Asia/Singapore",
          },
        ],
      };
      const corrected = await ingestDestinationCatalog(client.db, correctedCatalog, {
        mode: "refresh",
      });
      expect(corrected.quarantineResolved).toBe(1);
      const resolved = await client.pool.query<{ status: string }>(`
        select status from destination_ingestion_quarantine
        where provider = 'roavia-curated' and provider_record_id = 'place:invalid-city'
      `);
      expect(resolved.rows).toEqual([{ status: "resolved" }]);
    } finally {
      await cleanFixtureData(client);
      await client.close();
    }
  });
});
