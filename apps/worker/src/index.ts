import {
  createDatabaseClient,
  ingestDestinationCatalog,
  mvpLaunchDestinationCatalog,
} from "@roavia/db";
import {
  MemoryReferenceEffectStore,
  createDestinationCatalogIngestionJob,
  createReferenceJob,
} from "@roavia/jobs";
import { PgBossJobRuntime } from "@roavia/jobs/pg-boss";

import { formatJobTelemetry } from "./telemetry.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to start the Roavia worker.");

const releaseSha = process.env.RENDER_GIT_COMMIT ?? "local";
const database = createDatabaseClient(connectionString);
const runtime = new PgBossJobRuntime({
  connectionString,
  releaseSha,
  telemetry: (event) => console.log(formatJobTelemetry(event, releaseSha)),
});

runtime.register(createReferenceJob(new MemoryReferenceEffectStore()));
runtime.register(
  createDestinationCatalogIngestionJob({
    ingest: async (payload) => ({
      ...(await ingestDestinationCatalog(database.db, mvpLaunchDestinationCatalog, {
        mode: payload.mode,
      })),
    }),
  }),
);
await runtime.start();
console.log(JSON.stringify({ event: "ready", releaseSha, service: "roavia-worker" }));

async function shutdown(signal: string) {
  console.log(JSON.stringify({ event: "shutdown_started", service: "roavia-worker", signal }));
  await runtime.shutdown();
  await database.close();
  console.log(JSON.stringify({ event: "shutdown_completed", service: "roavia-worker", signal }));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
