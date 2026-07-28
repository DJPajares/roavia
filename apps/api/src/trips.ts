import {
  tripChildDeleteInputSchema,
  tripChildDeleteResponseSchema,
  tripCreateInputSchema,
  tripDayCreateInputSchema,
  tripDayMutationResponseSchema,
  tripDayUpdateInputSchema,
  tripDeleteInputSchema,
  tripDeleteResponseSchema,
  tripDestinationCreateInputSchema,
  tripDestinationMutationResponseSchema,
  tripDestinationUpdateInputSchema,
  tripIdSchema,
  tripItemCreateInputSchema,
  tripItemMutationResponseSchema,
  tripItemUpdateInputSchema,
  tripListQuerySchema,
  tripListResponseSchema,
  tripResponseSchema,
  tripUpdateInputSchema,
} from "@roavia/contracts";
import type { TripRepository } from "@roavia/db";
import type { Hono } from "hono";

import { type ApiEnvironment, errorResponse } from "./http.js";

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function routeId(candidate: string): string | undefined {
  const parsed = tripIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function registerTripRoutes(
  app: Hono<ApiEnvironment>,
  tripRepository: TripRepository | undefined,
) {
  app.get("/trips", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }

    const query = tripListQuerySchema.safeParse({
      cursor: context.req.query("cursor"),
      limit: context.req.query("limit"),
      status: context.req.query("status"),
    });
    if (!query.success) {
      return errorResponse(context, 400, "bad_request", "Trip list parameters are invalid.");
    }

    const data = await tripRepository.listTrips(
      context.get("authSession").identity.userId,
      query.data,
    );
    return context.json(
      tripListResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });

  app.post("/trips", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }

    const input = tripCreateInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Trip details are invalid.");
    }

    const data = await tripRepository.createTrip(
      context.get("authSession").identity.userId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
      201,
    );
  });

  app.get("/trips/:tripId", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }

    const data = await tripRepository.getTrip(context.get("authSession").identity.userId, tripId);
    return context.json(
      tripResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });

  app.patch("/trips/:tripId", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const input = tripUpdateInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Trip changes are invalid.");
    }

    const data = await tripRepository.updateTrip(
      context.get("authSession").identity.userId,
      tripId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });

  app.delete("/trips/:tripId", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const input = tripDeleteInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Trip deletion is invalid.");
    }

    const data = await tripRepository.deleteTrip(
      context.get("authSession").identity.userId,
      tripId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripDeleteResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });

  app.post("/trips/:tripId/destinations", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const input = tripDestinationCreateInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Destination details are invalid.");
    }

    const data = await tripRepository.createDestination(
      context.get("authSession").identity.userId,
      tripId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripDestinationMutationResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
      201,
    );
  });

  app.patch("/trips/:tripId/destinations/:destinationId", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    const destinationId = routeId(context.req.param("destinationId"));
    if (!tripId || !destinationId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const input = tripDestinationUpdateInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Destination changes are invalid.");
    }

    const data = await tripRepository.updateDestination(
      context.get("authSession").identity.userId,
      tripId,
      destinationId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripDestinationMutationResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });

  app.delete("/trips/:tripId/destinations/:destinationId", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    const destinationId = routeId(context.req.param("destinationId"));
    if (!tripId || !destinationId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const input = tripChildDeleteInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Destination deletion is invalid.");
    }

    const data = await tripRepository.deleteDestination(
      context.get("authSession").identity.userId,
      tripId,
      destinationId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripChildDeleteResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });

  app.post("/trips/:tripId/days", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const input = tripDayCreateInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Itinerary-day details are invalid.");
    }

    const data = await tripRepository.createDay(
      context.get("authSession").identity.userId,
      tripId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripDayMutationResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
      201,
    );
  });

  app.patch("/trips/:tripId/days/:dayId", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    const dayId = routeId(context.req.param("dayId"));
    if (!tripId || !dayId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const input = tripDayUpdateInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Itinerary-day changes are invalid.");
    }

    const data = await tripRepository.updateDay(
      context.get("authSession").identity.userId,
      tripId,
      dayId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripDayMutationResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });

  app.delete("/trips/:tripId/days/:dayId", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    const dayId = routeId(context.req.param("dayId"));
    if (!tripId || !dayId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const input = tripChildDeleteInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Itinerary-day deletion is invalid.");
    }

    const data = await tripRepository.deleteDay(
      context.get("authSession").identity.userId,
      tripId,
      dayId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripChildDeleteResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });

  app.post("/trips/:tripId/items", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const input = tripItemCreateInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Itinerary-item details are invalid.");
    }

    const data = await tripRepository.createItem(
      context.get("authSession").identity.userId,
      tripId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripItemMutationResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
      201,
    );
  });

  app.patch("/trips/:tripId/items/:itemId", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    const itemId = routeId(context.req.param("itemId"));
    if (!tripId || !itemId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const input = tripItemUpdateInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Itinerary-item changes are invalid.");
    }

    const data = await tripRepository.updateItem(
      context.get("authSession").identity.userId,
      tripId,
      itemId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripItemMutationResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });

  app.delete("/trips/:tripId/items/:itemId", async (context) => {
    if (!tripRepository) {
      return errorResponse(
        context,
        503,
        "trip_service_unavailable",
        "Trip planning is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    const itemId = routeId(context.req.param("itemId"));
    if (!tripId || !itemId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const input = tripChildDeleteInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Itinerary-item deletion is invalid.");
    }

    const data = await tripRepository.deleteItem(
      context.get("authSession").identity.userId,
      tripId,
      itemId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      tripChildDeleteResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });
}
