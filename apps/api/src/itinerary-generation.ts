import {
  itineraryGenerationQueuedResponseSchema,
  itineraryGenerationRequestInputSchema,
  itineraryGenerationStatusResponseSchema,
  tripIdSchema,
  type ItineraryGenerationQueued,
  type ItineraryGenerationRequestInput,
  type ItineraryGenerationSummary,
} from "@roavia/contracts";
import type { Hono } from "hono";

import { type ApiEnvironment, errorResponse } from "./http.js";

export interface ItineraryGenerationApiService {
  getGeneration(authUserId: string, tripId: string): Promise<ItineraryGenerationSummary | null>;
  requestGeneration(
    authUserId: string,
    tripId: string,
    input: ItineraryGenerationRequestInput,
    context: { correlationId: string },
  ): Promise<ItineraryGenerationQueued>;
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
    const data = await service.requestGeneration(
      context.get("authSession").identity.userId,
      tripId,
      input.data,
      { correlationId: context.get("requestId") },
    );
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
}
