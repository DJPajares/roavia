import {
  API_CONTRACT_VERSION,
  authSessionResponseSchema,
  destinationSearchQuerySchema,
  destinationDetailResponseSchema,
  destinationSearchResponseSchema,
  seasonalCollectionResponseSchema,
  healthResponseSchema,
  requestIdSchema,
  type DestinationSearchQuery,
  type DestinationSearchResponse,
  type DestinationDetailResponse,
  type SeasonalCollectionResponse,
} from "@roavia/contracts";
import {
  AssistantActionConflictError,
  AuthorizedResourceNotFoundError,
  DisruptionRecommendationConflictError,
  TripConcurrencyError,
  TripDomainInputError,
  type ProfileRepository,
  type OfflinePackageRepository,
  type ShareRepository,
  type TripRepository,
} from "@roavia/db";
import {
  RuntimeObservability,
  authorizeMetricsRequest,
  createTraceContext,
} from "@roavia/observability";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";

import { AuthVerificationError, type AccessTokenVerifier } from "./auth.js";
import { registerAccountRoutes } from "./accounts.js";
import type { AccountLifecycleService } from "./account-lifecycle.js";
import { registerAssistantRoutes, type AssistantApiService } from "./assistant.js";
import {
  registerDisruptionRecommendationRoutes,
  type DisruptionRecommendationApiService,
} from "./disruptions.js";
import { type ApiEnvironment, errorResponse } from "./http.js";
import {
  registerItineraryGenerationRoutes,
  type ItineraryGenerationApiService,
} from "./itinerary-generation.js";
import { registerOfflinePackageRoutes } from "./offline.js";
import {
  createFixedWindowRateLimiter,
  rateLimitClientAddress,
  type RateLimiter,
} from "./rate-limit.js";
import { registerProfileRoutes } from "./profiles.js";
import { registerTripPlannerRoutes, type TripPlannerApiService } from "./trip-planner.js";
import { registerShareRoutes } from "./sharing.js";
import { registerTripRoutes } from "./trips.js";

function createRequestId(candidate: string | undefined): string {
  return requestIdSchema.safeParse(candidate).success ? candidate! : crypto.randomUUID();
}

export interface CreateAppOptions {
  corsOrigins?: string[];
  verifyAccessToken?: AccessTokenVerifier;
  searchDestinations?: (
    query: DestinationSearchQuery,
  ) => Promise<DestinationSearchResponse["data"]>;
  getDestinationDetail?: (placeId: string) => Promise<DestinationDetailResponse["data"] | null>;
  listExploreSeasonalCollections?: () => Promise<SeasonalCollectionResponse["data"]["collections"]>;
  searchRateLimiter?: RateLimiter;
  assistantRateLimiter?: RateLimiter;
  generationRateLimiter?: RateLimiter;
  plannerRateLimiter?: RateLimiter;
  accountExportRateLimiter?: RateLimiter;
  maxRequestBodyBytes?: number;
  trustedProxyHops?: number;
  accountLifecycleService?: AccountLifecycleService;
  profileRepository?: ProfileRepository;
  offlinePackageRepository?: OfflinePackageRepository;
  shareRepository?: ShareRepository;
  tripRepository?: TripRepository;
  itineraryGenerationService?: ItineraryGenerationApiService;
  tripPlannerService?: TripPlannerApiService;
  assistantService?: AssistantApiService;
  disruptionRecommendationService?: DisruptionRecommendationApiService;
  metricsToken?: string;
  observability?: RuntimeObservability;
}

const unavailableVerifier: AccessTokenVerifier = () =>
  Promise.reject(new Error("Authentication is not configured."));

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }

  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1];
}

export function createApp(options: CreateAppOptions = {}) {
  const corsOrigins = options.corsOrigins ?? ["http://localhost:3000"];
  const verifyAccessToken = options.verifyAccessToken ?? unavailableVerifier;
  const searchRateLimiter = options.searchRateLimiter ?? createFixedWindowRateLimiter();
  const assistantRateLimiter =
    options.assistantRateLimiter ?? createFixedWindowRateLimiter({ limit: 20 });
  const generationRateLimiter =
    options.generationRateLimiter ??
    createFixedWindowRateLimiter({ limit: 5, windowMs: 60 * 60 * 1_000 });
  const plannerRateLimiter =
    options.plannerRateLimiter ??
    createFixedWindowRateLimiter({ limit: 10, windowMs: 60 * 60 * 1_000 });
  const accountExportRateLimiter =
    options.accountExportRateLimiter ??
    createFixedWindowRateLimiter({ limit: 3, windowMs: 24 * 60 * 60 * 1_000 });
  const app = new Hono<ApiEnvironment>();

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        baseUri: ["'none'"],
        defaultSrc: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
      crossOriginResourcePolicy: "cross-origin",
      permissionsPolicy: {
        camera: [],
        geolocation: [],
        microphone: [],
        payment: [],
      },
      referrerPolicy: "no-referrer",
      xFrameOptions: "DENY",
    }),
  );

  app.use(
    "*",
    cors({
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Traceparent",
        "X-Request-Id",
        "X-Roavia-Export-Grant",
      ],
      allowMethods: ["DELETE", "GET", "OPTIONS", "PATCH", "POST"],
      exposeHeaders: [
        "Content-Disposition",
        "Retry-After",
        "Traceparent",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "X-Request-Id",
      ],
      origin: (origin) => (corsOrigins.includes(origin) ? origin : ""),
    }),
  );

  app.use("*", async (context, next) => {
    const requestId = createRequestId(context.req.header("x-request-id"));
    const trace = createTraceContext(context.req.header("traceparent"));
    context.set("requestId", requestId);
    context.set("traceId", trace.traceId);
    context.set("observabilityErrorCode", undefined);
    context.set("observabilityRecorded", false);
    context.set("observabilityStartedAt", Date.now());
    context.header("x-request-id", requestId);
    context.header("traceparent", trace.traceparent);
    options.observability?.apiRequestStarted({
      correlationId: requestId,
      method: context.req.method,
      route: "request.pending",
      traceId: trace.traceId,
    });
    let threw = false;
    try {
      await next();
    } catch (error) {
      threw = true;
      throw error;
    } finally {
      if (!threw && !context.get("observabilityRecorded")) {
        options.observability?.recordApiRequest({
          correlationId: requestId,
          durationMs: Math.max(0, Date.now() - context.get("observabilityStartedAt")),
          errorCode: context.get("observabilityErrorCode"),
          method: context.req.method,
          route: context.req.routePath,
          statusCode: context.res.status,
          traceId: trace.traceId,
        });
        context.set("observabilityRecorded", true);
      }
    }
  });

  app.use(
    "*",
    bodyLimit({
      maxSize: options.maxRequestBodyBytes ?? 64 * 1_024,
      onError: (context) =>
        errorResponse(
          context,
          413,
          "payload_too_large",
          "The request body exceeds the configured API limit.",
        ),
    }),
  );

  const metricsToken = options.metricsToken;
  const observability = options.observability;
  if (metricsToken && observability) {
    app.get("/internal/metrics", (context) => {
      if (!authorizeMetricsRequest(context.req.header("authorization"), metricsToken)) {
        context.set("observabilityErrorCode", "metrics_unauthorized");
        return context.text("Unauthorized", 401);
      }
      return context.body(observability.metrics.renderOpenMetrics(), 200, {
        "cache-control": "no-store",
        "content-type": "application/openmetrics-text; version=1.0.0; charset=utf-8",
      });
    });
  }

  app.get("/health", (context) =>
    context.json(
      healthResponseSchema.parse({
        data: {
          service: "api",
          status: "ok",
          version: API_CONTRACT_VERSION,
        },
        meta: {
          requestId: context.get("requestId"),
        },
      }),
    ),
  );

  app.get("/destinations/search", async (context) => {
    const parsedQuery = destinationSearchQuerySchema.safeParse({
      query: context.req.query("q"),
      page: context.req.query("page"),
      limit: context.req.query("limit"),
      types: context.req.queries("type") ?? [],
      country: context.req.query("country"),
      regionId: context.req.query("regionId"),
    });

    if (!parsedQuery.success) {
      return errorResponse(
        context,
        400,
        "bad_request",
        "Destination search parameters are invalid.",
      );
    }

    const clientKey = rateLimitClientAddress({
      forwardedFor: context.req.header("x-forwarded-for"),
      remoteAddress: context.env?.incoming?.socket?.remoteAddress,
      trustedProxyHops: options.trustedProxyHops ?? 0,
    });
    const rateLimit = searchRateLimiter.consume(clientKey);
    context.header("x-ratelimit-limit", String(rateLimit.limit));
    context.header("x-ratelimit-remaining", String(rateLimit.remaining));
    context.header("x-ratelimit-reset", rateLimit.resetAt.toISOString());

    if (!rateLimit.allowed) {
      context.header(
        "retry-after",
        String(Math.max(1, Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1_000))),
      );
      return errorResponse(
        context,
        429,
        "rate_limited",
        "Too many destination searches. Please try again shortly.",
      );
    }

    if (!options.searchDestinations) {
      return errorResponse(
        context,
        503,
        "search_unavailable",
        "Destination search is temporarily unavailable.",
      );
    }

    const data = await options.searchDestinations(parsedQuery.data);
    return context.json(
      destinationSearchResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });

  app.get("/destinations/:placeId", async (context) => {
    if (!options.getDestinationDetail) {
      return errorResponse(
        context,
        503,
        "search_unavailable",
        "Destination details are temporarily unavailable.",
      );
    }
    const data = await options.getDestinationDetail(context.req.param("placeId"));
    if (!data) return errorResponse(context, 404, "not_found", "Destination not found.");
    return context.json(
      destinationDetailResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });

  app.get("/explore/seasonal", async (context) => {
    if (!options.listExploreSeasonalCollections) {
      return errorResponse(
        context,
        503,
        "explore_unavailable",
        "Seasonal collections are temporarily unavailable.",
      );
    }
    const collections = await options.listExploreSeasonalCollections();
    return context.json(
      seasonalCollectionResponseSchema.parse({
        data: { collections },
        meta: { requestId: context.get("requestId") },
      }),
    );
  });

  const requireAuthentication: MiddlewareHandler<ApiEnvironment> = async (context, next) => {
    context.header("cache-control", "private, no-store");
    const authorization = context.req.header("authorization");
    const accessToken = bearerToken(authorization);

    if (!authorization) {
      return errorResponse(context, 401, "authentication_required", "Authentication is required.");
    }

    if (!accessToken) {
      return errorResponse(context, 401, "invalid_session", "The session is invalid.");
    }

    try {
      const session = await verifyAccessToken(accessToken);
      context.set("accessToken", accessToken);
      context.set("authSession", session);
      const deletion = await options.accountLifecycleService?.findDeletion(session.identity.userId);
      const deletionRoute = context.req.path === "/me/deletion";
      if (deletion && !deletionRoute) {
        return errorResponse(
          context,
          401,
          "account_deleted",
          "This account has been deleted and cannot access Roavia data.",
        );
      }
    } catch (error) {
      if (error instanceof AuthVerificationError) {
        return errorResponse(context, 401, error.code, error.message);
      }

      throw error;
    }

    await next();
  };

  app.use("/auth/*", requireAuthentication);
  app.use("/me", requireAuthentication);
  app.use("/me/*", requireAuthentication);
  app.use("/trips", requireAuthentication);
  app.use("/trips/*", requireAuthentication);
  app.use("/planner/*", requireAuthentication);
  app.use("/assistant/*", requireAuthentication);

  app.get("/auth/session", (context) =>
    context.json(
      authSessionResponseSchema.parse({
        data: context.get("authSession"),
        meta: {
          requestId: context.get("requestId"),
        },
      }),
    ),
  );

  registerTripRoutes(app, options.tripRepository);
  registerOfflinePackageRoutes(app, options.offlinePackageRepository, options.observability);
  registerItineraryGenerationRoutes(app, options.itineraryGenerationService, generationRateLimiter);
  registerTripPlannerRoutes(app, options.tripPlannerService, plannerRateLimiter);
  registerAssistantRoutes(app, options.assistantService, assistantRateLimiter);
  registerDisruptionRecommendationRoutes(app, options.disruptionRecommendationService);
  registerShareRoutes(app, options.shareRepository);
  registerProfileRoutes(app, options.profileRepository);
  registerAccountRoutes(app, options.accountLifecycleService, accountExportRateLimiter);

  app.notFound((context) => errorResponse(context, 404, "not_found", "Route not found."));

  app.onError((error, context) => {
    const response = (() => {
      if (error instanceof AuthorizedResourceNotFoundError) {
        return errorResponse(context, 404, "not_found", "Resource not found.");
      }

      if (error instanceof TripConcurrencyError) {
        return errorResponse(context, 409, "conflict", error.message);
      }

      if (error instanceof AssistantActionConflictError) {
        return errorResponse(context, 409, "assistant_action_conflict", error.message);
      }

      if (error instanceof DisruptionRecommendationConflictError) {
        return errorResponse(context, 409, error.code, error.message);
      }

      if (error instanceof TripDomainInputError) {
        return errorResponse(context, 400, "bad_request", error.message);
      }

      if (error instanceof Error && "code" in error && error.code === "generation_state_conflict") {
        return errorResponse(context, 409, "conflict", error.message);
      }

      if (error instanceof HTTPException && error.status < 500) {
        return errorResponse(context, 400, "bad_request", "Request could not be processed.");
      }

      return errorResponse(context, 500, "internal_error", "An unexpected error occurred.");
    })();
    if (!context.get("observabilityRecorded")) {
      options.observability?.recordApiRequest({
        correlationId: context.get("requestId"),
        durationMs: Math.max(0, Date.now() - context.get("observabilityStartedAt")),
        errorCode: context.get("observabilityErrorCode"),
        method: context.req.method,
        route: context.req.routePath,
        statusCode: response.status,
        traceId: context.get("traceId"),
      });
      context.set("observabilityRecorded", true);
    }
    return response;
  });

  return app;
}

export const app = createApp();
