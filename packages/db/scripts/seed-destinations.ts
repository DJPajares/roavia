import { createDatabaseClient } from "../src/client.js";
import { ingestDestinationCatalog } from "../src/destination-ingestion.js";
import { mvpLaunchDestinationCatalog } from "../src/fixtures/mvp-launch-destinations.js";
import { loadRootEnv } from "./load-root-env.js";

loadRootEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to seed curated destinations.");

const client = createDatabaseClient(databaseUrl);
try {
  const summary = await ingestDestinationCatalog(client.db, mvpLaunchDestinationCatalog, {
    mode: "seed",
  });
  console.log(JSON.stringify({ event: "destination_catalog_ingested", ...summary }));
} finally {
  await client.close();
}
