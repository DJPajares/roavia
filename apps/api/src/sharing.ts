import {
  shareLinkCreateInputSchema,
  shareLinkCreateResponseSchema,
  shareLinkIdSchema,
  shareLinkListResponseSchema,
  shareLinkRevokeResponseSchema,
  shareTokenSchema,
  sharedTripResponseSchema,
  tripIdSchema,
} from "@roavia/contracts";
import type { ShareRepository } from "@roavia/db";
import type { Hono } from "hono";

import { type ApiEnvironment, errorResponse } from "./http.js";

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function idFrom(candidate: string) {
  const parsed = tripIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function registerShareRoutes(
  app: Hono<ApiEnvironment>,
  shareRepository: ShareRepository | undefined,
) {
  app.get("/shared-trips/:token", async (context) => {
    context.header("cache-control", "private, no-store");
    context.header("x-robots-tag", "noindex, nofollow");
    if (!shareRepository) {
      return errorResponse(
        context,
        503,
        "share_service_unavailable",
        "Shared trips are temporarily unavailable.",
      );
    }
    const token = shareTokenSchema.safeParse(context.req.param("token"));
    if (!token.success) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const data = await shareRepository.getSharedTrip(token.data);
    return context.json(
      sharedTripResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });

  app.get("/trips/:tripId/share-links", async (context) => {
    if (!shareRepository) {
      return errorResponse(
        context,
        503,
        "share_service_unavailable",
        "Trip sharing is temporarily unavailable.",
      );
    }
    const tripId = idFrom(context.req.param("tripId"));
    if (!tripId) return errorResponse(context, 404, "not_found", "Resource not found.");
    const links = await shareRepository.listLinks(
      context.get("authSession").identity.userId,
      tripId,
    );
    return context.json(
      shareLinkListResponseSchema.parse({
        data: { links },
        meta: { requestId: context.get("requestId") },
      }),
    );
  });

  app.post("/trips/:tripId/share-links", async (context) => {
    if (!shareRepository) {
      return errorResponse(
        context,
        503,
        "share_service_unavailable",
        "Trip sharing is temporarily unavailable.",
      );
    }
    const tripId = idFrom(context.req.param("tripId"));
    if (!tripId) return errorResponse(context, 404, "not_found", "Resource not found.");
    const input = shareLinkCreateInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Share-link details are invalid.");
    }
    const data = await shareRepository.createLink(
      context.get("authSession").identity.userId,
      tripId,
      input.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      shareLinkCreateResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
      201,
    );
  });

  app.delete("/trips/:tripId/share-links/:shareLinkId", async (context) => {
    if (!shareRepository) {
      return errorResponse(
        context,
        503,
        "share_service_unavailable",
        "Trip sharing is temporarily unavailable.",
      );
    }
    const tripId = idFrom(context.req.param("tripId"));
    const shareLinkId = shareLinkIdSchema.safeParse(context.req.param("shareLinkId"));
    if (!tripId || !shareLinkId.success) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const data = await shareRepository.revokeLink(
      context.get("authSession").identity.userId,
      tripId,
      shareLinkId.data,
      { correlationId: context.get("requestId") },
    );
    return context.json(
      shareLinkRevokeResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });
}
