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
  createAccountLifecycleRepository,
  createDatabaseClient,
  ingestDestinationCatalog,
  mvpLaunchDestinationCatalog,
  type AiTelemetryRepository,
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
import { RuntimeObservability, readObservabilityConfig } from "@roavia/observability";
import { OpenMeteoForecastAdapter, OpenMeteoLiveConditionSource } from "@roavia/travel-data/server";

import {
  createWorkerJobTelemetry,
  startAccountRetentionMonitor,
  startJobHealthMonitor,
} from "./telemetry.js";

try {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to start the Roavia worker.");

const observabilityConfig = readObservabilityConfig(process.env);
const observability = new RuntimeObservability({
  environment: observabilityConfig.environment,
  releaseSha: observabilityConfig.releaseSha,
  service: "roavia-worker",
});
const database = createDatabaseClient(connectionString);
const persistentAiTelemetry = createAiTelemetryRepository(database.db);
const aiTelemetry = {
  aggregate: (query) => persistentAiTelemetry.aggregate(query),
  pruneExpired: (now) => persistentAiTelemetry.pruneExpired(now),
  async recordAssistantAction(input) {
    observability.recordAiAction(input);
    await persistentAiTelemetry.recordAssistantAction(input);
  },
  async recordGeneration(input) {
    observability.recordAiGeneration({
      costMicros: input.cost?.amountMicros,
      durationMs: input.durationMs,
      errorCode: input.errorCode,
      inputTokens: input.usage?.inputTokens,
      model: input.model,
      operation: input.operation,
      outcome: input.outcome,
      outputTokens: input.usage?.outputTokens,
      provider: input.provider,
      requestId: input.requestId,
    });
    await persistentAiTelemetry.recordGeneration(input);
  },
  async recordQuality(input) {
    observability.recordAiQuality({
      correlationId: input.correlationId,
      operation: "itinerary",
      outcome: input.outcome,
      repairCount: input.repairCount,
      validationFailureCount: input.issueCodes.length,
    });
    await persistentAiTelemetry.recordQuality(input);
  },
} satisfies AiTelemetryRepository;
const runtime = new PgBossJobRuntime({
  connectionString,
  releaseSha: observabilityConfig.releaseSha,
  telemetry: createWorkerJobTelemetry(observability),
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
          { telemetry: (event) => observability.recordProvider(event) },
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
const stopJobHealthMonitor = startJobHealthMonitor(runtime, observability);
const stopAccountRetentionMonitor = startAccountRetentionMonitor(
  createAccountLifecycleRepository(database.db),
  observability,
);
observability.logger.log({
  event: "worker_ready",
  level: "info",
  operation: "worker.start",
  outcome: "ready",
});

async function shutdown(signal: string) {
  stopAccountRetentionMonitor();
  stopJobHealthMonitor();
  observability.logger.log({
    event: "shutdown_started",
    level: "info",
    operation: "worker.shutdown",
    outcome: signal,
  });
  await runtime.shutdown();
  await database.close();
  observability.logger.log({
    event: "shutdown_completed",
    level: "info",
    operation: "worker.shutdown",
    outcome: signal,
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
