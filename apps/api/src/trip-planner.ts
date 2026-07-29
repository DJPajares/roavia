import {
  tripIntentExtractionInputSchema,
  tripIntentExtractionResponseSchema,
  type TripIntentExtraction,
  type TripIntentExtractionInput,
} from "@roavia/contracts";
import type { Hono } from "hono";

import { type ApiEnvironment, errorResponse } from "./http.js";

export interface TripPlannerApiService {
  extract(
    input: TripIntentExtractionInput,
    context: { authUserId: string; requestId: string; signal: AbortSignal },
  ): Promise<TripIntentExtraction>;
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function registerTripPlannerRoutes(
  app: Hono<ApiEnvironment>,
  service: TripPlannerApiService | undefined,
) {
  app.post("/planner/extract", async (context) => {
    if (!service) {
      return errorResponse(
        context,
        503,
        "planner_service_unavailable",
        "Natural-language planning is temporarily unavailable.",
      );
    }
    const input = tripIntentExtractionInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "The planning request is invalid.");
    }
    try {
      const data = await service.extract(input.data, {
        authUserId: context.get("authSession").identity.userId,
        requestId: context.get("requestId"),
        signal: context.req.raw.signal,
      });
      return context.json(
        tripIntentExtractionResponseSchema.parse({
          data,
          meta: { requestId: context.get("requestId") },
        }),
      );
    } catch (error) {
      const retryable =
        typeof error === "object" && error !== null && "retryable" in error && error.retryable;
      return errorResponse(
        context,
        retryable ? 503 : 400,
        "planner_extraction_failed",
        retryable
          ? "We could not interpret the request right now. Try again shortly."
          : "We could not interpret this request. Edit it and try again.",
      );
    }
  });
}
