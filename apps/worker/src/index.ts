import {
  GroundingRetriever,
  ItineraryGenerationEngine,
  ItineraryGenerationService,
} from "@roavia/ai";
import {
  PostgresGroundingDataSource,
  PostgresItineraryGenerationStore,
  aiTokenPricingFromEnvironment,
  createVercelGatewayAiGateway,
} from "@roavia/ai/server";
import {
  createAiTelemetryRepository,
  createDatabaseClient,
  ingestDestinationCatalog,
  mvpLaunchDestinationCatalog,
} from "@roavia/db";
import {
  MemoryReferenceEffectStore,
  createDestinationCatalogIngestionJob,
  createItineraryGenerationJob,
  createLiveConditionReconciliationJob,
  createLiveConditionReconciliationService,
  createPostgresLiveConditionStores,
  createReferenceJob,
} from "@roavia/jobs";
import { PgBossJobRuntime } from "@roavia/jobs/pg-boss";
import { OpenMeteoForecastAdapter, OpenMeteoLiveConditionSource } from "@roavia/travel-data/server";

import { formatJobTelemetry } from "./telemetry.js";

try {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to start the Roavia worker.");

const releaseSha = process.env.RENDER_GIT_COMMIT ?? "local";
const database = createDatabaseClient(connectionString);
const aiTelemetry = createAiTelemetryRepository(database.db);
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
if (
  process.env.WEATHER_PROVIDER?.trim().toLowerCase() === "open-meteo" &&
  process.env.WEATHER_API_KEY &&
  process.env.WEATHER_API_KEY.trim().length >= 8 &&
  !/\s/.test(process.env.WEATHER_API_KEY)
) {
  const stores = createPostgresLiveConditionStores(database.db);
  runtime.register(
    createLiveConditionReconciliationJob(
      createLiveConditionReconciliationService({
        ...stores,
        source: new OpenMeteoLiveConditionSource(
          new OpenMeteoForecastAdapter({ apiKey: process.env.WEATHER_API_KEY }),
        ),
      }),
    ),
  );
}
if (
  process.env.AI_PROVIDER === "vercel-gateway" &&
  process.env.AI_API_KEY &&
  process.env.AI_MODEL
) {
  const gateway = createVercelGatewayAiGateway({
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
    pricing: aiTokenPricingFromEnvironment(process.env),
    telemetry: (event) => aiTelemetry.recordGeneration(event),
  });
  const store = new PostgresItineraryGenerationStore(database.db, aiTelemetry);
  runtime.register(
    createItineraryGenerationJob(
      new ItineraryGenerationService({
        engine: new ItineraryGenerationEngine(gateway),
        retriever: new GroundingRetriever([new PostgresGroundingDataSource(database.db)]),
        store,
      }),
    ),
  );
}
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
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
