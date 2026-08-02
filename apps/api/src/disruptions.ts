import type { DisruptionAlternativeGenerator } from "@roavia/ai";
import {
  disruptionRecommendationDecisionInputSchema,
  disruptionRecommendationListResponseSchema,
  disruptionRecommendationMutationResponseSchema,
  type DisruptionRecommendationListResponse,
  type DisruptionRecommendationMutationResponse,
} from "@roavia/contracts";
import type {
  AssistantActionRepository,
  DisruptionRecommendationRepository,
  TripRepository,
} from "@roavia/db";
import type { Hono } from "hono";

import type { AssistantActionMutationService, AssistantApiContext } from "./assistant.js";
import { type ApiEnvironment, errorResponse } from "./http.js";

export interface DisruptionRecommendationApiService {
  apply(
    tripId: string,
    recommendationId: string,
    context: AssistantApiContext,
  ): Promise<DisruptionRecommendationMutationResponse["data"]>;
  decide(
    tripId: string,
    recommendationId: string,
    decision: "dismiss" | "keep",
    context: AssistantApiContext,
  ): Promise<DisruptionRecommendationMutationResponse["data"]>;
  list(
    tripId: string,
    context: AssistantApiContext & { refresh: boolean },
  ): Promise<DisruptionRecommendationListResponse["data"]>;
}

function errorCode(error: unknown) {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 100);
  }
  return "apply_failed";
}

export function createDisruptionRecommendationApiService(dependencies: {
  actions: AssistantActionRepository;
  generator?: DisruptionAlternativeGenerator;
  mutations: AssistantActionMutationService;
  recommendations: DisruptionRecommendationRepository;
  trips: TripRepository;
}): DisruptionRecommendationApiService {
  return {
    async list(tripId, context) {
      const generation = await dependencies.recommendations.generationState(
        context.authUserId,
        tripId,
      );
      let providerUnavailable = false;

      if (context.refresh && generation.candidates.length > 0) {
        if (!dependencies.generator) {
          providerUnavailable = true;
        } else {
          const trip = await dependencies.trips.getTrip(context.authUserId, tripId);
          for (const impact of generation.candidates) {
            try {
              const snapshot = await dependencies.generator.generate({
                impact,
                requestId: context.requestId,
                signal: context.signal,
                trip,
              });
              if (snapshot) {
                await dependencies.recommendations.create(context.authUserId, snapshot);
              }
            } catch {
              providerUnavailable = true;
              break;
            }
          }
        }
      }

      const recommendations = await dependencies.recommendations.list(context.authUserId, tripId);
      const liveDataStatus =
        recommendations.length > 0
          ? "fresh"
          : providerUnavailable
            ? "provider_unavailable"
            : generation.hasStaleImpacts
              ? "stale"
              : "none";
      return { liveDataStatus, recommendations };
    },

    async decide(tripId, recommendationId, decision, context) {
      const result = await dependencies.recommendations.decide(
        context.authUserId,
        tripId,
        recommendationId,
        decision,
      );
      return { ...result, tripRevision: null };
    },

    async apply(tripId, recommendationId, context) {
      const snapshot = await dependencies.recommendations.beginApply(
        context.authUserId,
        tripId,
        recommendationId,
      );
      let actionId: string | undefined;
      try {
        const trip = await dependencies.trips.getTrip(context.authUserId, tripId);
        const [preview] = await dependencies.actions.createPreviews(
          context.authUserId,
          tripId,
          trip.revision,
          [
            {
              itemId: snapshot.original.itemId,
              kind: "replace_item",
              placeId: snapshot.alternative.placeId,
              sourceIds: [snapshot.impact.source.sourceId, snapshot.alternative.source.sourceId],
              summary: `Replace ${snapshot.original.name} with ${snapshot.alternative.name}`,
            },
          ],
          { correlationId: context.requestId },
        );
        if (!preview) throw new Error("The confirmed replacement preview could not be created.");
        actionId = preview.actionId;
        const applied = await dependencies.mutations.confirm(actionId, context);
        await dependencies.recommendations.finishApply(recommendationId, {
          actionId,
          status: "applied",
        });
        return {
          recommendationId,
          status: "applied",
          tripId,
          tripRevision: applied.tripRevision,
        };
      } catch (error) {
        await dependencies.recommendations
          .finishApply(recommendationId, {
            actionId,
            failureCode: errorCode(error),
            status: "failed",
          })
          .catch(() => undefined);
        throw error;
      }
    },
  };
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function routeId(candidate: string): string | undefined {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    candidate,
  )
    ? candidate
    : undefined;
}

function unavailable(context: Parameters<typeof errorResponse>[0]) {
  return errorResponse(
    context,
    503,
    "disruption_service_unavailable",
    "Live disruption alternatives are temporarily unavailable.",
  );
}

export function registerDisruptionRecommendationRoutes(
  app: Hono<ApiEnvironment>,
  service: DisruptionRecommendationApiService | undefined,
) {
  app.get("/trips/:tripId/disruption-recommendations", async (context) => {
    if (!service) return unavailable(context);
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) return errorResponse(context, 404, "not_found", "Resource not found.");
    const data = await service.list(tripId, {
      authUserId: context.get("authSession").identity.userId,
      refresh: false,
      requestId: context.get("requestId"),
      signal: context.req.raw.signal,
    });
    return context.json(
      disruptionRecommendationListResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });

  app.post("/trips/:tripId/disruption-recommendations/refresh", async (context) => {
    if (!service) return unavailable(context);
    const tripId = routeId(context.req.param("tripId"));
    if (!tripId) return errorResponse(context, 404, "not_found", "Resource not found.");
    const data = await service.list(tripId, {
      authUserId: context.get("authSession").identity.userId,
      refresh: true,
      requestId: context.get("requestId"),
      signal: context.req.raw.signal,
    });
    return context.json(
      disruptionRecommendationListResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });

  app.post(
    "/trips/:tripId/disruption-recommendations/:recommendationId/decision",
    async (context) => {
      if (!service) return unavailable(context);
      const tripId = routeId(context.req.param("tripId"));
      const recommendationId = routeId(context.req.param("recommendationId"));
      if (!tripId || !recommendationId) {
        return errorResponse(context, 404, "not_found", "Resource not found.");
      }
      const input = disruptionRecommendationDecisionInputSchema.safeParse(
        await requestBody(context.req.raw),
      );
      if (!input.success) {
        return errorResponse(
          context,
          400,
          "bad_request",
          "The recommendation decision is invalid.",
        );
      }
      const data = await service.decide(tripId, recommendationId, input.data.decision, {
        authUserId: context.get("authSession").identity.userId,
        requestId: context.get("requestId"),
        signal: context.req.raw.signal,
      });
      return context.json(
        disruptionRecommendationMutationResponseSchema.parse({
          data,
          meta: { requestId: context.get("requestId") },
        }),
      );
    },
  );

  app.post("/trips/:tripId/disruption-recommendations/:recommendationId/apply", async (context) => {
    if (!service) return unavailable(context);
    const tripId = routeId(context.req.param("tripId"));
    const recommendationId = routeId(context.req.param("recommendationId"));
    if (!tripId || !recommendationId) {
      return errorResponse(context, 404, "not_found", "Resource not found.");
    }
    const data = await service.apply(tripId, recommendationId, {
      authUserId: context.get("authSession").identity.userId,
      requestId: context.get("requestId"),
      signal: context.req.raw.signal,
    });
    return context.json(
      disruptionRecommendationMutationResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });
}
