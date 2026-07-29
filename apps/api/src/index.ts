import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import {
  GroundingRetriever,
  GroundedAssistantService,
  ItineraryGenerationEngine,
  ItineraryGenerationService,
  TripIntentExtractionService,
} from "@roavia/ai";
import {
  PostgresGroundingDataSource,
  PostgresItineraryGenerationStore,
  createVercelGatewayAiGateway,
} from "@roavia/ai/server";
import {
  createDatabaseClient,
  createAssistantActionRepository,
  createProfileRepository,
  createShareRepository,
  createTripRepository,
  searchDestinations,
} from "@roavia/db";
import {
  createItineraryGenerationJob,
  createItineraryGenerationRequestService,
} from "@roavia/jobs";
import { PgBossJobRuntime } from "@roavia/jobs/pg-boss";

import { createApp } from "./app.js";
import { createAssistantApiService } from "./assistant.js";
import { createAccessTokenVerifierFromEnvironment } from "./auth.js";

try {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const database = process.env.DATABASE_URL
  ? createDatabaseClient(process.env.DATABASE_URL)
  : undefined;
const aiGateway =
  process.env.AI_PROVIDER === "vercel-gateway" && process.env.AI_API_KEY && process.env.AI_MODEL
    ? createVercelGatewayAiGateway({
        apiKey: process.env.AI_API_KEY,
        model: process.env.AI_MODEL,
      })
    : undefined;
const destinationResolver = database
  ? (query: Parameters<typeof searchDestinations>[1]) => searchDestinations(database.db, query)
  : undefined;
const tripPlannerService =
  aiGateway && destinationResolver
    ? new TripIntentExtractionService(aiGateway, destinationResolver)
    : undefined;
const tripRepository = database ? createTripRepository(database.db) : undefined;
const assistantService =
  aiGateway && database && tripRepository
    ? createAssistantApiService({
        actions: createAssistantActionRepository(database.db),
        assistant: new GroundedAssistantService(
          aiGateway,
          new GroundingRetriever([new PostgresGroundingDataSource(database.db)]),
        ),
        trips: tripRepository,
      })
    : undefined;
const generationStore = database ? new PostgresItineraryGenerationStore(database.db) : undefined;
const jobRuntime =
  process.env.DATABASE_URL && aiGateway && generationStore && database
    ? new PgBossJobRuntime({
        applicationName: "roavia-api",
        connectionString: process.env.DATABASE_URL,
        releaseSha: process.env.RENDER_GIT_COMMIT ?? "local",
      })
    : undefined;
if (jobRuntime && aiGateway && generationStore && database) {
  const generationService = new ItineraryGenerationService({
    engine: new ItineraryGenerationEngine(aiGateway),
    retriever: new GroundingRetriever([new PostgresGroundingDataSource(database.db)]),
    store: generationStore,
  });
  jobRuntime.register(createItineraryGenerationJob(generationService));
  await jobRuntime.start({ workers: false });
}
const corsOrigins = process.env.CORS_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const app = createApp({
  corsOrigins: corsOrigins && corsOrigins.length > 0 ? corsOrigins : undefined,
  verifyAccessToken: createAccessTokenVerifierFromEnvironment(process.env),
  searchDestinations: destinationResolver,
  profileRepository: database ? createProfileRepository(database.db) : undefined,
  shareRepository: database ? createShareRepository(database.db) : undefined,
  tripRepository,
  assistantService,
  tripPlannerService,
  itineraryGenerationService:
    jobRuntime && generationStore
      ? createItineraryGenerationRequestService(jobRuntime, generationStore)
      : undefined,
});

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Roavia API listening on http://localhost:${info.port}`);
  },
);

async function shutdown() {
  server.close();
  await jobRuntime?.shutdown();
  await database?.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
