import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import {
  GroundingRetriever,
  GroundedDisruptionAlternativeService,
  GroundedAssistantService,
  ItineraryGenerationEngine,
  ItineraryGenerationService,
  TripIntentExtractionService,
} from "@roavia/ai";
import {
  destinationSeasonalInsightSchema,
  type DestinationSeasonalityQuery,
} from "@roavia/contracts";
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
  createAssistantActionRepository,
  createDisruptionRecommendationRepository,
  createProfileRepository,
  createOfflinePackageRepository,
  createShareRepository,
  createTripRepository,
  getDestinationDetail,
  listExploreSeasonalCollections,
  listSeasonalInsights,
  searchDestinations,
  type AiTelemetryRepository,
} from "@roavia/db";
import {
  createItineraryGenerationJob,
  createItineraryGenerationRequestService,
} from "@roavia/jobs";
import { PgBossJobRuntime } from "@roavia/jobs/pg-boss";
import { RuntimeObservability, readObservabilityConfig } from "@roavia/observability";
import { computeSeasonalInsight } from "@roavia/travel-data";

import { createApp } from "./app.js";
import { createSupabaseAccountIdentityAdmin } from "./account-identity.js";
import { createAccountLifecycleService } from "./account-lifecycle.js";
import { createAssistantActionMutationService, createAssistantApiService } from "./assistant.js";
import { createAccessTokenVerifierFromEnvironment } from "./auth.js";
import { createDisruptionRecommendationApiService } from "./disruptions.js";
import { parseTrustedProxyHops } from "./rate-limit.js";

try {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const observabilityConfig = readObservabilityConfig(process.env);
const observability = new RuntimeObservability({
  environment: observabilityConfig.environment,
  releaseSha: observabilityConfig.releaseSha,
  service: "roavia-api",
});
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const database = process.env.DATABASE_URL
  ? createDatabaseClient(process.env.DATABASE_URL)
  : undefined;
const persistentAiTelemetry = database ? createAiTelemetryRepository(database.db) : undefined;
const aiTelemetry = persistentAiTelemetry
  ? ({
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
    } satisfies AiTelemetryRepository)
  : undefined;
const recordAiGeneration = aiTelemetry
  ? (event: Parameters<AiTelemetryRepository["recordGeneration"]>[0]) =>
      aiTelemetry.recordGeneration(event)
  : (event: Parameters<AiTelemetryRepository["recordGeneration"]>[0]) => {
      observability.recordAiGeneration({
        costMicros: event.cost?.amountMicros,
        durationMs: event.durationMs,
        errorCode: event.errorCode,
        inputTokens: event.usage?.inputTokens,
        model: event.model,
        operation: event.operation,
        outcome: event.outcome,
        outputTokens: event.usage?.outputTokens,
        provider: event.provider,
        requestId: event.requestId,
      });
    };
const aiGateway =
  process.env.AI_PROVIDER === "vercel-gateway" && process.env.AI_API_KEY && process.env.AI_MODEL
    ? createVercelGatewayAiGateway({
        apiKey: process.env.AI_API_KEY,
        model: process.env.AI_MODEL,
        pricing: aiTokenPricingFromEnvironment(process.env),
        telemetry: recordAiGeneration,
      })
    : undefined;
const destinationResolver = database
  ? (query: Parameters<typeof searchDestinations>[1]) => searchDestinations(database.db, query)
  : undefined;
const destinationDetailResolver = database
  ? async (placeId: string) => {
      const detail = await getDestinationDetail(database.db, placeId);
      return (
        detail && {
          ...detail,
          content: detail.content.map((record) => ({
            ...record,
            refreshedAt: record.refreshedAt.toISOString(),
            sources: record.sources.map((source) => ({
              ...source,
              retrievedAt: source.retrievedAt.toISOString(),
            })),
          })),
        }
      );
    }
  : undefined;
const seasonalCollectionResolver = database
  ? async () => {
      const collections = await listExploreSeasonalCollections(database.db);
      return collections.map((collection) => ({
        ...collection,
        refreshedAt: collection.refreshedAt.toISOString(),
        sources: collection.sources.map((source) => ({
          ...source,
          retrievedAt: source.retrievedAt.toISOString(),
        })),
      }));
    }
  : undefined;
const destinationSeasonalityResolver = database
  ? async (placeId: string, priorities: DestinationSeasonalityQuery) => {
      const stored = await listSeasonalInsights(database.db, placeId);
      return {
        insights: stored.map(({ computedInsight }) => {
          const insight = destinationSeasonalInsightSchema.parse(computedInsight);
          return destinationSeasonalInsightSchema.parse(
            computeSeasonalInsight({
              evidence: Object.values(insight.signals).flatMap(({ evidence }) => evidence),
              period: insight.period,
              placeId: insight.placeId,
              priorities,
              refreshedAt: insight.refreshedAt,
            }),
          );
        }),
      };
    }
  : undefined;
const tripPlannerService =
  aiGateway && destinationResolver
    ? new TripIntentExtractionService(aiGateway, destinationResolver)
    : undefined;
const tripRepository = database ? createTripRepository(database.db) : undefined;
const assistantActions = database ? createAssistantActionRepository(database.db) : undefined;
const assistantMutations =
  assistantActions && tripRepository
    ? createAssistantActionMutationService({
        actions: assistantActions,
        telemetry: aiTelemetry,
        trips: tripRepository,
      })
    : undefined;
const assistantService =
  aiGateway && database && tripRepository && assistantActions
    ? createAssistantApiService({
        actions: assistantActions,
        assistant: new GroundedAssistantService(
          aiGateway,
          new GroundingRetriever([new PostgresGroundingDataSource(database.db)]),
        ),
        telemetry: aiTelemetry,
        trips: tripRepository,
      })
    : undefined;
const disruptionRecommendationService =
  database && tripRepository && assistantActions && assistantMutations
    ? createDisruptionRecommendationApiService({
        actions: assistantActions,
        generator: aiGateway
          ? new GroundedDisruptionAlternativeService(
              aiGateway,
              new GroundingRetriever([new PostgresGroundingDataSource(database.db)]),
            )
          : undefined,
        mutations: assistantMutations,
        recommendations: createDisruptionRecommendationRepository(database.db),
        trips: tripRepository,
      })
    : undefined;
const generationStore = database
  ? new PostgresItineraryGenerationStore(database.db, aiTelemetry)
  : undefined;
const jobRuntime =
  process.env.DATABASE_URL && database
    ? new PgBossJobRuntime({
        applicationName: "roavia-api",
        connectionString: process.env.DATABASE_URL,
        releaseSha: observabilityConfig.releaseSha,
        telemetry: (event) => observability.recordJob(event),
      })
    : undefined;
if (jobRuntime && aiGateway && generationStore && database) {
  const generationService = new ItineraryGenerationService({
    engine: new ItineraryGenerationEngine(aiGateway),
    retriever: new GroundingRetriever([new PostgresGroundingDataSource(database.db)]),
    store: generationStore,
  });
  jobRuntime.register(createItineraryGenerationJob(generationService));
}
await jobRuntime?.start({ workers: false });
const accountLifecycleService =
  database &&
  jobRuntime &&
  process.env.ACCOUNT_LIFECYCLE_SECRET &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAccountLifecycleService({
        identityAdmin: createSupabaseAccountIdentityAdmin({
          serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          url: process.env.SUPABASE_URL,
        }),
        jobs: jobRuntime,
        repository: createAccountLifecycleRepository(database.db),
        secret: process.env.ACCOUNT_LIFECYCLE_SECRET,
      })
    : undefined;
const corsOrigins = process.env.CORS_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const app = createApp({
  accountLifecycleService,
  corsOrigins: corsOrigins && corsOrigins.length > 0 ? corsOrigins : undefined,
  verifyAccessToken: createAccessTokenVerifierFromEnvironment(process.env),
  searchDestinations: destinationResolver,
  getDestinationDetail: destinationDetailResolver,
  listExploreSeasonalCollections: seasonalCollectionResolver,
  getDestinationSeasonality: destinationSeasonalityResolver,
  profileRepository: database ? createProfileRepository(database.db) : undefined,
  offlinePackageRepository: database ? createOfflinePackageRepository(database.db) : undefined,
  shareRepository: database ? createShareRepository(database.db) : undefined,
  tripRepository,
  assistantService,
  disruptionRecommendationService,
  tripPlannerService,
  itineraryGenerationService:
    jobRuntime && generationStore
      ? createItineraryGenerationRequestService(jobRuntime, generationStore)
      : undefined,
  metricsToken: observabilityConfig.metricsToken,
  observability,
  readiness: async () => {
    if (!database || !jobRuntime) throw new Error("Database and queue runtime are required.");
    await database.pool.query("select 1");
    await database.pool.query("select version from jobs.version order by version desc limit 1");
  },
  trustedProxyHops: parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS),
});

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  () => {
    observability.logger.log({
      event: "server_ready",
      level: "info",
      operation: "api.listen",
      outcome: "ready",
    });
  },
);

async function shutdown() {
  observability.logger.log({
    event: "shutdown_started",
    level: "info",
    operation: "api.shutdown",
  });
  server.close();
  await jobRuntime?.shutdown();
  await database?.close();
  observability.logger.log({
    event: "shutdown_completed",
    level: "info",
    operation: "api.shutdown",
    outcome: "completed",
  });
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
