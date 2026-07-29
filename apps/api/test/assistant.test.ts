import type {
  AssistantActionPayload,
  AssistantActionPreview,
  AssistantAnswer,
  AssistantQueryInput,
  TripDetail,
} from "@roavia/contracts";
import type { AiTelemetryRepository, AssistantActionRepository, TripRepository } from "@roavia/db";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "../src/app.js";
import { createAssistantApiService, type AssistantApiService } from "../src/assistant.js";

const AUTH_USER_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "20000000-0000-4000-8000-000000000002";
const TRIP_ID = "30000000-0000-4000-8000-000000000003";
const ACTION_ID = "40000000-0000-4000-8000-000000000004";
const ITEM_ID = "50000000-0000-4000-8000-000000000005";
const DAY_ID = "60000000-0000-4000-8000-000000000006";
const PLACE_ID = "70000000-0000-4000-8000-000000000007";
const SOURCE_ID = "source-official";

const input: AssistantQueryInput = {
  context: { tripId: TRIP_ID, type: "trip" },
  locale: "en",
  question: "What should I change in this itinerary?",
};

const answer: AssistantAnswer = {
  actions: [],
  answer: "Review the current opening hours before visiting.",
  claims: [
    {
      claimId: "claim-1",
      confidence: { explanation: "The official source is current.", level: "high" },
      sourceIds: [SOURCE_ID],
      text: "Opening hours should be checked before visiting.",
    },
  ],
  evidence: { gaps: [], status: "complete" },
  safety: {
    classification: "general",
    disclaimer: null,
    explanation: "This is general travel planning guidance.",
    officialSourceRequired: false,
  },
  sources: [
    {
      freshness: "fresh",
      official: true,
      retrievedAt: "2026-07-29T00:00:00.000Z",
      sourceId: SOURCE_ID,
      title: "Official destination guide",
      url: "https://example.gov.test/guide",
      validUntil: null,
    },
  ],
  status: "answered",
  uncertainty: { explanation: "Hours can change.", level: "medium" },
};

const preview: AssistantActionPreview = {
  actionId: ACTION_ID,
  expectedTripRevision: 4,
  expiresAt: "2026-07-29T00:15:00.000Z",
  payload: {
    itemId: ITEM_ID,
    kind: "save_note",
    note: "Check official opening hours.",
    sourceIds: [SOURCE_ID],
    summary: "Save an opening-hours reminder",
  },
  status: "pending",
  tripId: TRIP_ID,
};

const trip = { id: TRIP_ID, revision: 4 } as TripDetail;

const headers = {
  authorization: "Bearer test-token",
  "content-type": "application/json",
  "x-request-id": REQUEST_ID,
};

function app(service?: AssistantApiService) {
  return createApp({
    assistantService: service,
    verifyAccessToken: async () => ({
      expiresAt: "2026-07-29T01:00:00.000Z",
      identity: { userId: AUTH_USER_ID },
    }),
  });
}

describe("assistant API", () => {
  test("requires authentication, service availability, and a valid grounded question", async () => {
    const unauthenticated = await app().request("/assistant/query", { method: "POST" });
    const unavailable = await app().request("/assistant/query", {
      body: JSON.stringify(input),
      headers,
      method: "POST",
    });
    const invalid = await app({} as AssistantApiService).request("/assistant/query", {
      body: JSON.stringify({ context: { tripId: "invalid", type: "trip" }, question: "Hi" }),
      headers,
      method: "POST",
    });

    expect(unauthenticated.status).toBe(401);
    expect(unavailable.status).toBe(503);
    expect(invalid.status).toBe(400);
  });

  test("returns grounded answers and delegates explicit confirm and cancel requests", async () => {
    const service: AssistantApiService = {
      cancel: vi.fn<AssistantApiService["cancel"]>().mockResolvedValue({
        actionId: ACTION_ID,
        status: "cancelled",
        tripId: TRIP_ID,
        tripRevision: null,
      }),
      confirm: vi.fn<AssistantApiService["confirm"]>().mockResolvedValue({
        actionId: ACTION_ID,
        status: "applied",
        tripId: TRIP_ID,
        tripRevision: 5,
      }),
      query: vi
        .fn<AssistantApiService["query"]>()
        .mockResolvedValue({ ...answer, actions: [preview] }),
    };

    const queried = await app(service).request("/assistant/query", {
      body: JSON.stringify(input),
      headers,
      method: "POST",
    });
    const confirmed = await app(service).request(`/assistant/actions/${ACTION_ID}/confirm`, {
      headers,
      method: "POST",
    });
    const cancelled = await app(service).request(`/assistant/actions/${ACTION_ID}/cancel`, {
      headers,
      method: "POST",
    });

    expect(queried.status).toBe(200);
    await expect(queried.json()).resolves.toMatchObject({
      data: { actions: [{ actionId: ACTION_ID }], status: "answered" },
      meta: { requestId: REQUEST_ID },
    });
    expect(confirmed.status).toBe(200);
    expect(cancelled.status).toBe(200);
    expect(service.query).toHaveBeenCalledWith(
      input,
      expect.objectContaining({ authUserId: AUTH_USER_ID, requestId: REQUEST_ID }),
    );
    expect(service.confirm).toHaveBeenCalledWith(
      ACTION_ID,
      expect.objectContaining({ authUserId: AUTH_USER_ID }),
    );
    expect(service.cancel).toHaveBeenCalledWith(
      ACTION_ID,
      expect.objectContaining({ authUserId: AUTH_USER_ID }),
    );
  });

  test("previews first, then applies a confirmed action through the normal trip repository", async () => {
    const getTrip = vi.fn<TripRepository["getTrip"]>().mockResolvedValue(trip);
    const updateItem = vi
      .fn<TripRepository["updateItem"]>()
      .mockResolvedValue({ item: {} as never, tripRevision: 5 });
    const trips = { getTrip, updateItem } as unknown as TripRepository;
    const createPreviews = vi
      .fn<AssistantActionRepository["createPreviews"]>()
      .mockResolvedValue([preview]);
    const claim = vi.fn<AssistantActionRepository["claim"]>().mockResolvedValue({
      actionId: ACTION_ID,
      correlationId: REQUEST_ID,
      expectedTripRevision: 4,
      payload: preview.payload,
      tripId: TRIP_ID,
    });
    const cancel = vi.fn<AssistantActionRepository["cancel"]>().mockResolvedValue({
      actionId: ACTION_ID,
      correlationId: REQUEST_ID,
      tripId: TRIP_ID,
    });
    const resolve = vi.fn<AssistantActionRepository["resolve"]>().mockResolvedValue(undefined);
    const actions = {
      cancel,
      claim,
      createPreviews,
      resolve,
    } as AssistantActionRepository;
    const assistant = {
      answer: vi
        .fn<
          () => Promise<{
            actionPayloads: AssistantActionPreview["payload"][];
            answer: AssistantAnswer;
          }>
        >()
        .mockResolvedValue({ actionPayloads: [preview.payload], answer }),
    };
    const recordAssistantAction = vi
      .fn<AiTelemetryRepository["recordAssistantAction"]>()
      .mockResolvedValue(undefined);
    const service = createAssistantApiService({
      actions,
      assistant,
      telemetry: { recordAssistantAction },
      trips,
    });

    const queried = await service.query(input, {
      authUserId: AUTH_USER_ID,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    });
    expect(queried.actions).toEqual([preview]);
    expect(updateItem).not.toHaveBeenCalled();

    await expect(
      service.confirm(ACTION_ID, {
        authUserId: AUTH_USER_ID,
        requestId: REQUEST_ID,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      actionId: ACTION_ID,
      status: "applied",
      tripId: TRIP_ID,
      tripRevision: 5,
    });
    expect(updateItem).toHaveBeenCalledWith(
      AUTH_USER_ID,
      TRIP_ID,
      ITEM_ID,
      { expectedTripRevision: 4, notes: "Check official opening hours." },
      { correlationId: REQUEST_ID },
    );
    expect(resolve).toHaveBeenCalledWith(ACTION_ID, "applied");

    await service.cancel(ACTION_ID, {
      authUserId: AUTH_USER_ID,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    });
    expect(cancel).toHaveBeenCalledWith(AUTH_USER_ID, ACTION_ID);
    expect(recordAssistantAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ actionCount: 1, outcome: "offered" }),
    );
    expect(recordAssistantAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ actionCount: 1, outcome: "confirmed" }),
    );
    expect(recordAssistantAction).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ actionCount: 1, outcome: "cancelled" }),
    );
  });

  test("routes add, replace, remove, and reorder confirmations through trip mutations", async () => {
    const payloads: AssistantActionPayload[] = [
      {
        itineraryDayId: DAY_ID,
        itemType: "activity",
        kind: "add_place",
        notes: null,
        placeId: PLACE_ID,
        sourceIds: [SOURCE_ID],
        summary: "Add the museum",
      },
      {
        itemId: ITEM_ID,
        kind: "replace_item",
        placeId: PLACE_ID,
        sourceIds: [SOURCE_ID],
        summary: "Replace the attraction",
      },
      {
        itemId: ITEM_ID,
        kind: "remove_item",
        sourceIds: [SOURCE_ID],
        summary: "Remove the attraction",
      },
      {
        itineraryDayId: DAY_ID,
        itemId: ITEM_ID,
        kind: "reorder_item",
        orderIndex: 1,
        sourceIds: [SOURCE_ID],
        summary: "Move the attraction later",
      },
    ];
    const actionIds = [
      "81000000-0000-4000-8000-000000000001",
      "82000000-0000-4000-8000-000000000002",
      "83000000-0000-4000-8000-000000000003",
      "84000000-0000-4000-8000-000000000004",
    ];
    const claim = vi.fn<AssistantActionRepository["claim"]>();
    payloads.forEach((payload, index) => {
      claim.mockResolvedValueOnce({
        actionId: actionIds[index]!,
        correlationId: REQUEST_ID,
        expectedTripRevision: 4,
        payload,
        tripId: TRIP_ID,
      });
    });
    const resolve = vi.fn<AssistantActionRepository["resolve"]>().mockResolvedValue(undefined);
    const actions = {
      cancel: vi.fn<AssistantActionRepository["cancel"]>(),
      claim,
      createPreviews: vi.fn<AssistantActionRepository["createPreviews"]>(),
      resolve,
    };
    const createItem = vi
      .fn<TripRepository["createItem"]>()
      .mockResolvedValue({ item: {} as never, tripRevision: 5 });
    const updateItem = vi
      .fn<TripRepository["updateItem"]>()
      .mockResolvedValue({ item: {} as never, tripRevision: 5 });
    const deleteItem = vi
      .fn<TripRepository["deleteItem"]>()
      .mockResolvedValue({ deletedId: ITEM_ID, tripRevision: 5 });
    const trips = { createItem, deleteItem, updateItem } as unknown as TripRepository;
    const assistant = {
      answer: vi.fn<() => Promise<{ actionPayloads: []; answer: AssistantAnswer }>>(),
    };
    const service = createAssistantApiService({ actions, assistant, trips });
    const context = {
      authUserId: AUTH_USER_ID,
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
    };

    for (const actionId of actionIds) await service.confirm(actionId, context);

    expect(createItem).toHaveBeenCalledWith(
      AUTH_USER_ID,
      TRIP_ID,
      expect.objectContaining({
        expectedTripRevision: 4,
        itineraryDayId: DAY_ID,
        placeId: PLACE_ID,
      }),
      { correlationId: REQUEST_ID },
    );
    expect(updateItem).toHaveBeenCalledWith(
      AUTH_USER_ID,
      TRIP_ID,
      ITEM_ID,
      expect.objectContaining({ expectedTripRevision: 4, placeId: PLACE_ID }),
      { correlationId: REQUEST_ID },
    );
    expect(deleteItem).toHaveBeenCalledWith(
      AUTH_USER_ID,
      TRIP_ID,
      ITEM_ID,
      { expectedTripRevision: 4 },
      { correlationId: REQUEST_ID },
    );
    expect(updateItem).toHaveBeenCalledWith(
      AUTH_USER_ID,
      TRIP_ID,
      ITEM_ID,
      { expectedTripRevision: 4, itineraryDayId: DAY_ID, orderIndex: 1 },
      { correlationId: REQUEST_ID },
    );
    expect(resolve).toHaveBeenCalledTimes(4);
  });
});
