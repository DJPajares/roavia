import { AssistantGenerationError } from "@roavia/ai";
import {
  assistantActionMutationResponseSchema,
  assistantQueryInputSchema,
  assistantQueryResponseSchema,
  type AssistantActionMutation,
  type AssistantActionPayload,
  type AssistantAnswer,
  type AssistantQueryInput,
} from "@roavia/contracts";
import type {
  AiTelemetryRepository,
  AssistantActionRepository,
  ClaimedAssistantAction,
  TripRepository,
} from "@roavia/db";
import type { Hono } from "hono";

import { type ApiEnvironment, errorResponse } from "./http.js";
import type { RateLimiter } from "./rate-limit.js";

interface AssistantDraftService {
  answer(
    input: AssistantQueryInput,
    context?: {
      requestId?: string;
      signal?: AbortSignal;
      trip?: Awaited<ReturnType<TripRepository["getTrip"]>>;
    },
  ): Promise<{ actionPayloads: AssistantActionPayload[]; answer: AssistantAnswer }>;
}

export interface AssistantApiContext {
  authUserId: string;
  requestId: string;
  signal: AbortSignal;
}

export interface AssistantApiService {
  query(input: AssistantQueryInput, context: AssistantApiContext): Promise<AssistantAnswer>;
  confirm(actionId: string, context: AssistantApiContext): Promise<AssistantActionMutation>;
  cancel(actionId: string, context: AssistantApiContext): Promise<AssistantActionMutation>;
}

async function applyAction(
  tripRepository: TripRepository,
  authUserId: string,
  action: ClaimedAssistantAction,
): Promise<number> {
  const mutationContext = { correlationId: action.correlationId };
  const expectedTripRevision = action.expectedTripRevision;
  const provenance = {
    assistant: { actionId: action.actionId, sourceIds: action.payload.sourceIds },
  };
  if (action.payload.kind === "add_place") {
    const result = await tripRepository.createItem(
      authUserId,
      action.tripId,
      {
        booking: {},
        confidence: null,
        durationMinutes: null,
        endTime: null,
        estimatedCost: null,
        expectedTripRevision,
        itineraryDayId: action.payload.itineraryDayId,
        itemType: action.payload.itemType,
        notes: action.payload.notes,
        placeId: action.payload.placeId,
        sourceSnapshot: provenance,
        startTime: null,
        transport: {},
      },
      mutationContext,
    );
    return result.tripRevision;
  }
  if (action.payload.kind === "replace_item") {
    const result = await tripRepository.updateItem(
      authUserId,
      action.tripId,
      action.payload.itemId,
      {
        expectedTripRevision,
        placeId: action.payload.placeId,
        sourceSnapshot: provenance,
      },
      mutationContext,
    );
    return result.tripRevision;
  }
  if (action.payload.kind === "remove_item") {
    const result = await tripRepository.deleteItem(
      authUserId,
      action.tripId,
      action.payload.itemId,
      { expectedTripRevision },
      mutationContext,
    );
    return result.tripRevision;
  }
  if (action.payload.kind === "reorder_item") {
    const result = await tripRepository.updateItem(
      authUserId,
      action.tripId,
      action.payload.itemId,
      {
        expectedTripRevision,
        itineraryDayId: action.payload.itineraryDayId,
        orderIndex: action.payload.orderIndex,
      },
      mutationContext,
    );
    return result.tripRevision;
  }
  const result = await tripRepository.updateItem(
    authUserId,
    action.tripId,
    action.payload.itemId,
    { expectedTripRevision, notes: action.payload.note },
    mutationContext,
  );
  return result.tripRevision;
}

export function createAssistantApiService(dependencies: {
  actions: AssistantActionRepository;
  assistant: AssistantDraftService;
  telemetry?: Pick<AiTelemetryRepository, "recordAssistantAction">;
  trips: TripRepository;
}): AssistantApiService {
  return {
    async query(input, context) {
      const trip =
        input.context.type === "trip"
          ? await dependencies.trips.getTrip(context.authUserId, input.context.tripId)
          : undefined;
      const draft = await dependencies.assistant.answer(input, {
        requestId: context.requestId,
        signal: context.signal,
        trip,
      });
      if (!trip || draft.actionPayloads.length === 0) return draft.answer;
      const actions = await dependencies.actions.createPreviews(
        context.authUserId,
        trip.id,
        trip.revision,
        draft.actionPayloads,
        { correlationId: context.requestId },
      );
      await dependencies.telemetry
        ?.recordAssistantAction({
          actionCount: actions.length,
          correlationId: context.requestId,
          outcome: "offered",
          timestamp: new Date().toISOString(),
        })
        .catch(() => undefined);
      return { ...draft.answer, actions };
    },

    async confirm(actionId, context) {
      const action = await dependencies.actions.claim(context.authUserId, actionId);
      let tripRevision: number;
      try {
        tripRevision = await applyAction(dependencies.trips, context.authUserId, action);
      } catch (error) {
        await dependencies.actions.resolve(actionId, "failed").catch(() => undefined);
        await dependencies.telemetry
          ?.recordAssistantAction({
            actionCount: 1,
            correlationId: action.correlationId,
            outcome: "failed",
            timestamp: new Date().toISOString(),
          })
          .catch(() => undefined);
        throw error;
      }
      await dependencies.actions.resolve(actionId, "applied");
      await dependencies.telemetry
        ?.recordAssistantAction({
          actionCount: 1,
          correlationId: action.correlationId,
          outcome: "confirmed",
          timestamp: new Date().toISOString(),
        })
        .catch(() => undefined);
      return { actionId, status: "applied", tripId: action.tripId, tripRevision };
    },

    async cancel(actionId, context) {
      const action = await dependencies.actions.cancel(context.authUserId, actionId);
      await dependencies.telemetry
        ?.recordAssistantAction({
          actionCount: 1,
          correlationId: action.correlationId,
          outcome: "cancelled",
          timestamp: new Date().toISOString(),
        })
        .catch(() => undefined);
      return {
        actionId,
        status: "cancelled",
        tripId: action.tripId,
        tripRevision: null,
      };
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

export function registerAssistantRoutes(
  app: Hono<ApiEnvironment>,
  service: AssistantApiService | undefined,
  rateLimiter: RateLimiter,
) {
  app.post("/assistant/query", async (context) => {
    if (!service) {
      return errorResponse(
        context,
        503,
        "assistant_service_unavailable",
        "The travel assistant is temporarily unavailable.",
      );
    }
    const input = assistantQueryInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "The assistant question is invalid.");
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
        "Too many assistant questions. Please try again shortly.",
      );
    }
    try {
      const data = await service.query(input.data, {
        authUserId,
        requestId: context.get("requestId"),
        signal: context.req.raw.signal,
      });
      return context.json(
        assistantQueryResponseSchema.parse({
          data,
          meta: { requestId: context.get("requestId") },
        }),
      );
    } catch (error) {
      if (error instanceof AssistantGenerationError) {
        return errorResponse(
          context,
          error.retryable ? 503 : 500,
          "assistant_generation_failed",
          "The assistant could not produce a verified answer.",
        );
      }
      throw error;
    }
  });

  app.post("/assistant/actions/:actionId/confirm", async (context) => {
    if (!service) {
      return errorResponse(
        context,
        503,
        "assistant_service_unavailable",
        "The travel assistant is temporarily unavailable.",
      );
    }
    const actionId = routeId(context.req.param("actionId"));
    if (!actionId) return errorResponse(context, 404, "not_found", "Resource not found.");
    const data = await service.confirm(actionId, {
      authUserId: context.get("authSession").identity.userId,
      requestId: context.get("requestId"),
      signal: context.req.raw.signal,
    });
    return context.json(
      assistantActionMutationResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });

  app.post("/assistant/actions/:actionId/cancel", async (context) => {
    if (!service) {
      return errorResponse(
        context,
        503,
        "assistant_service_unavailable",
        "The travel assistant is temporarily unavailable.",
      );
    }
    const actionId = routeId(context.req.param("actionId"));
    if (!actionId) return errorResponse(context, 404, "not_found", "Resource not found.");
    const data = await service.cancel(actionId, {
      authUserId: context.get("authSession").identity.userId,
      requestId: context.get("requestId"),
      signal: context.req.raw.signal,
    });
    return context.json(
      assistantActionMutationResponseSchema.parse({
        data,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });
}
