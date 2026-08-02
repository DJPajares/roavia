import {
  itineraryGenerationCancelledResponseSchema,
  itineraryGenerationCancelInputSchema,
  itineraryGenerationQueuedResponseSchema,
  itineraryGenerationRequestInputSchema,
  itineraryGenerationStatusResponseSchema,
  tripIdSchema,
  type ItineraryGenerationQueued,
  type ItineraryGenerationCancelInput,
  type ItineraryGenerationRequestInput,
  type ItineraryGenerationSummary,
} from "@roavia/contracts";
import type { Hono } from "hono";

import { type ApiEnvironment, errorResponse } from "./http.js";
import type { RateLimiter } from "./rate-limit.js";

export interface ItineraryGenerationApiService {
  getGeneration(authUserId: string, tripId: string): Promise<ItineraryGenerationSummary | null>;
  requestGeneration(
    authUserId: string,
    tripId: string,
    input: ItineraryGenerationRequestInput,
    context: { correlationId: string },
  ): Promise<ItineraryGenerationQueued>;
  cancelGeneration?(
    authUserId: string,
    tripId: string,
    input: ItineraryGenerationCancelInput,
  ): Promise<{ generationRunId: string; jobId: string; status: "cancelled" } | null>;
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function routeId(candidate: string | undefined): string | undefined {
  const parsed = tripIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function registerItineraryGenerationRoutes(
  app: Hono<ApiEnvironment>,
  service: ItineraryGenerationApiService | undefined,
  rateLimiter: RateLimiter,
) {
  const requestGeneration = async (context: Parameters<typeof errorResponse>[0]) => {
    if (!service) {
      return errorResponse(
        context,
        503,
        "generation_service_unavailable",
        "Itinerary generation is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) return errorResponse(context, 404, "not_found", "Resource not found.");
    const input = itineraryGenerationRequestInputSchema.safeParse(
      await requestBody(context.req.raw),
    );
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Generation request is invalid.");
    }
    const authUserId = context.get("authSession").identity.userId;
    const rateLimit = rateLimiter.consume(authUserId);
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
        "Too many itinerary generation requests. Please try again later.",
      );
    }
    const data = await service.requestGeneration(authUserId, tripId, input.data, {
      correlationId: context.get("requestId"),
    });
    return context.json(
      itineraryGenerationQueuedResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
      202,
    );
  };

  app.post("/trips/:tripId/generate", requestGeneration);
  app.post("/trips/:tripId/regenerate", requestGeneration);

  app.get("/trips/:tripId/generation", async (context) => {
    if (!service) {
      return errorResponse(
        context,
        503,
        "generation_service_unavailable",
        "Itinerary generation is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) return errorResponse(context, 404, "not_found", "Resource not found.");
    const data = await service.getGeneration(context.get("authSession").identity.userId, tripId);
    return context.json(
      itineraryGenerationStatusResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });

  app.post("/trips/:tripId/generation/cancel", async (context) => {
    if (!service?.cancelGeneration) {
      return errorResponse(
        context,
        503,
        "generation_service_unavailable",
        "Itinerary generation is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) return errorResponse(context, 404, "not_found", "Resource not found.");
    const input = itineraryGenerationCancelInputSchema.safeParse(
      await requestBody(context.req.raw),
    );
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Cancellation request is invalid.");
    }
    const data = await service.cancelGeneration(
      context.get("authSession").identity.userId,
      tripId,
      input.data,
    );
    if (!data) return errorResponse(context, 404, "not_found", "Resource not found.");
    return context.json(
      itineraryGenerationCancelledResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });
}
