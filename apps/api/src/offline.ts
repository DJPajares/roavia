import {
  offlinePackageMutationResponseSchema,
  offlinePackageResponseSchema,
  tripIdSchema,
} from "@roavia/contracts";
import type { OfflinePackageRepository } from "@roavia/db";
import type { RuntimeObservability } from "@roavia/observability";
import type { Hono } from "hono";

import { type ApiEnvironment, errorResponse } from "./http.js";

function routeId(candidate: string): string | undefined {
  const parsed = tripIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function registerOfflinePackageRoutes(
  app: Hono<ApiEnvironment>,
  repository: OfflinePackageRepository | undefined,
  observability?: RuntimeObservability,
) {
  app.post("/trips/:tripId/offline-package", async (context) => {
    const startedAt = Date.now();
    if (!repository) {
      observability?.recordOffline({
        correlationId: context.get("requestId"),
        durationMs: 0,
        errorCode: "offline_service_unavailable",
        outcome: "error",
        traceId: context.get("traceId"),
      });
      return errorResponse(
        context,
        503,
        "offline_service_unavailable",
        "Offline package generation is temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) return errorResponse(context, 404, "not_found", "Resource not found.");
    let data: Awaited<ReturnType<OfflinePackageRepository["generate"]>>;
    try {
      data = await repository.generate(context.get("authSession").identity.userId, tripId, {
        now: new Date(),
      });
    } catch (error) {
      observability?.recordOffline({
        correlationId: context.get("requestId"),
        durationMs: Math.max(0, Date.now() - startedAt),
        errorCode: "offline_generation_failed",
        outcome: "error",
        traceId: context.get("traceId"),
      });
      throw error;
    }
    observability?.recordOffline({
      correlationId: context.get("requestId"),
      durationMs: Math.max(0, Date.now() - startedAt),
      outcome: "success",
      reused: data.reused,
      sizeBytes: data.package.sizeBytes,
      traceId: context.get("traceId"),
    });
    return context.json(
      offlinePackageMutationResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
      data.reused ? 200 : 201,
    );
  });

  app.get("/trips/:tripId/offline-package", async (context) => {
    if (!repository) {
      return errorResponse(
        context,
        503,
        "offline_service_unavailable",
        "Offline packages are temporarily unavailable.",
      );
    }
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) return errorResponse(context, 404, "not_found", "Resource not found.");
    const packageRecord = await repository.getLatest(
      context.get("authSession").identity.userId,
      tripId,
    );
    if (!packageRecord) return errorResponse(context, 404, "not_found", "Resource not found.");
    return context.json(
      offlinePackageResponseSchema.parse({
        data: { package: packageRecord },
        meta: { requestId: context.get("requestId") },
      }),
    );
  });
}
