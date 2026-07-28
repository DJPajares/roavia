import {
  API_CONTRACT_VERSION,
  authSessionResponseSchema,
  destinationSearchQuerySchema,
  destinationSearchResponseSchema,
  healthResponseSchema,
  requestIdSchema,
  type DestinationSearchQuery,
  type DestinationSearchResponse,
} from "@roavia/contracts";
import {
  AuthorizedResourceNotFoundError,
  TripConcurrencyError,
  TripDomainInputError,
  type TripRepository,
} from "@roavia/db";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { AuthVerificationError, type AccessTokenVerifier } from "./auth.js";
import { type ApiEnvironment, errorResponse } from "./http.js";
import { createFixedWindowRateLimiter, type RateLimiter } from "./rate-limit.js";
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
  searchRateLimiter?: RateLimiter;
  tripRepository?: TripRepository;
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
  const app = new Hono<ApiEnvironment>();

  app.use(
    "*",
    cors({
      allowHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
      allowMethods: ["DELETE", "GET", "OPTIONS", "PATCH", "POST"],
      origin: (origin) => (corsOrigins.includes(origin) ? origin : ""),
    }),
  );

  app.use("*", async (context, next) => {
    const requestId = createRequestId(context.req.header("x-request-id"));
    context.set("requestId", requestId);
    context.header("x-request-id", requestId);
    await next();
  });

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

    const clientKey = context.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
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

  const requireAuthentication: MiddlewareHandler<ApiEnvironment> = async (context, next) => {
    const authorization = context.req.header("authorization");
    const accessToken = bearerToken(authorization);

    if (!authorization) {
      return errorResponse(context, 401, "authentication_required", "Authentication is required.");
    }

    if (!accessToken) {
      return errorResponse(context, 401, "invalid_session", "The session is invalid.");
    }

    try {
      context.set("authSession", await verifyAccessToken(accessToken));
    } catch (error) {
      if (error instanceof AuthVerificationError) {
        return errorResponse(context, 401, error.code, error.message);
      }

      throw error;
    }

    await next();
  };

  app.use("/auth/*", requireAuthentication);
  app.use("/trips", requireAuthentication);
  app.use("/trips/*", requireAuthentication);

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

  app.notFound((context) => errorResponse(context, 404, "not_found", "Route not found."));

  app.onError((error, context) => {
    if (error instanceof AuthorizedResourceNotFoundError) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }

    if (error instanceof TripConcurrencyError) {
      return errorResponse(context, 409, "conflict", error.message);
    }

    if (error instanceof TripDomainInputError) {
      return errorResponse(context, 400, "bad_request", error.message);
    }

    if (error instanceof HTTPException && error.status < 500) {
      return errorResponse(context, 400, "bad_request", "Request could not be processed.");
    }

    return errorResponse(context, 500, "internal_error", "An unexpected error occurred.");
  });

  return app;
}

export const app = createApp();
