import type { TripDetail, TripItem } from "@roavia/contracts";
import {
  AuthorizedResourceNotFoundError,
  TripConcurrencyError,
  type TripRepository,
} from "@roavia/db";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "../src/app.js";

const userId = "11111111-1111-4111-8111-111111111111";
const tripId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const dayId = "44444444-4444-4444-8444-444444444444";
const itemId = "55555555-5555-4555-8555-555555555555";
const unavailable = () => Promise.reject(new Error("Unexpected repository call."));

const trip: TripDetail = {
  budget: { amountMinor: 250_000, currency: "USD", style: "midrange" },
  createdAt: "2026-07-28T10:00:00.000Z",
  dateFlexibility: { daysAfter: 0, daysBefore: 0 },
  days: [],
  destinations: [],
  endDate: "2026-09-12",
  generationState: "idle",
  id: tripId,
  originPlaceId: null,
  revision: 1,
  slug: "japan-in-autumn-test",
  startDate: "2026-09-05",
  status: "draft",
  title: "Japan in autumn",
  travelerSummary: { adults: 2, children: 0, infants: 0 },
  updatedAt: "2026-07-28T10:00:00.000Z",
  visibility: "private",
};

const item: TripItem = {
  booking: { reference: "ROA-42" },
  confidence: null,
  durationMinutes: 60,
  endTime: "10:00",
  estimatedCost: null,
  id: itemId,
  itineraryDayId: dayId,
  itemType: "activity",
  notes: "Morning walk",
  orderIndex: 0,
  placeId: null,
  sourceSnapshot: { place: { name: "Riverside" } },
  startTime: "09:00",
  transport: {},
};

function testApp(tripRepository?: TripRepository) {
  return createApp({
    tripRepository,
    verifyAccessToken: async () => ({
      expiresAt: "2026-07-28T11:00:00.000Z",
      identity: { userId },
    }),
  });
}

function repositoryWith(overrides: Partial<TripRepository>): TripRepository {
  return {
    createDay: unavailable,
    createDestination: unavailable,
    createItem: unavailable,
    createTrip: unavailable,
    deleteDay: unavailable,
    deleteDestination: unavailable,
    deleteItem: unavailable,
    deleteTrip: unavailable,
    getTrip: unavailable,
    listTrips: unavailable,
    updateDay: unavailable,
    updateDestination: unavailable,
    updateItem: unavailable,
    updateTrip: unavailable,
    ...overrides,
  } as TripRepository;
}

describe("trip API routes", () => {
  test("authenticates before reporting service availability", async () => {
    const app = testApp();
    const unauthenticated = await app.request("/trips");
    const serviceUnavailable = await app.request("/trips", {
      headers: { authorization: "Bearer test-token" },
    });

    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
    expect(serviceUnavailable.status).toBe(503);
    await expect(serviceUnavailable.json()).resolves.toMatchObject({
      error: { code: "trip_service_unavailable" },
    });
  });

  test("validates input and forwards identity and request correlation", async () => {
    const createTrip = vi.fn<TripRepository["createTrip"]>().mockResolvedValue(trip);
    const app = testApp(repositoryWith({ createTrip }));
    const invalid = await app.request("/trips", {
      body: JSON.stringify({ title: "Incomplete" }),
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      method: "POST",
    });
    const valid = await app.request("/trips", {
      body: JSON.stringify({
        budget: { amountMinor: 250_000, currency: "USD", style: "midrange" },
        endDate: "2026-09-12",
        startDate: "2026-09-05",
        title: "Japan in autumn",
        travelerSummary: { adults: 2 },
      }),
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
        "x-request-id": requestId,
      },
      method: "POST",
    });

    expect(invalid.status).toBe(400);
    expect(createTrip).toHaveBeenCalledTimes(1);
    expect(createTrip).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ title: "Japan in autumn" }),
      { correlationId: requestId },
    );
    expect(valid.status).toBe(201);
    await expect(valid.json()).resolves.toMatchObject({
      data: { id: tripId, revision: 1 },
      meta: { requestId },
    });
  });

  test("maps stale and unauthorized repository operations", async () => {
    const conflictApp = testApp(
      repositoryWith({ updateTrip: () => Promise.reject(new TripConcurrencyError()) }),
    );
    const notFoundApp = testApp(
      repositoryWith({ getTrip: () => Promise.reject(new AuthorizedResourceNotFoundError()) }),
    );
    const conflict = await conflictApp.request(`/trips/${tripId}`, {
      body: JSON.stringify({ expectedRevision: 1, title: "Changed" }),
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      method: "PATCH",
    });
    const notFound = await notFoundApp.request(`/trips/${tripId}`, {
      headers: { authorization: "Bearer test-token" },
    });

    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ error: { code: "conflict" } });
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toMatchObject({
      error: { code: "not_found", message: "Resource not found." },
    });
  });

  test("validates and forwards item create, reorder, delete, and concurrent edits", async () => {
    const createItem = vi
      .fn<TripRepository["createItem"]>()
      .mockResolvedValue({ item, tripRevision: 2 });
    const updateItem = vi
      .fn<TripRepository["updateItem"]>()
      .mockResolvedValue({ item, tripRevision: 3 });
    const deleteItem = vi
      .fn<TripRepository["deleteItem"]>()
      .mockResolvedValue({ deletedId: itemId, tripRevision: 4 });
    const app = testApp(repositoryWith({ createItem, deleteItem, updateItem }));
    const authenticatedHeaders = {
      authorization: "Bearer test-token",
      "content-type": "application/json",
      "x-request-id": requestId,
    };

    const invalid = await app.request(`/trips/${tripId}/items`, {
      body: JSON.stringify({
        expectedTripRevision: 1,
        itineraryDayId: dayId,
        itemType: "activity",
        startTime: "09:00",
      }),
      headers: authenticatedHeaders,
      method: "POST",
    });
    expect(invalid.status).toBe(400);
    expect(createItem).not.toHaveBeenCalled();

    const created = await app.request(`/trips/${tripId}/items`, {
      body: JSON.stringify({
        booking: { reference: "ROA-42" },
        endTime: "10:00",
        expectedTripRevision: 1,
        itineraryDayId: dayId,
        itemType: "activity",
        notes: "Morning walk",
        sourceSnapshot: { place: { name: "Riverside" } },
        startTime: "09:00",
      }),
      headers: authenticatedHeaders,
      method: "POST",
    });
    expect(created.status).toBe(201);
    expect(createItem).toHaveBeenCalledWith(
      userId,
      tripId,
      expect.objectContaining({ expectedTripRevision: 1, itineraryDayId: dayId }),
      { correlationId: requestId },
    );

    const reordered = await app.request(`/trips/${tripId}/items/${itemId}`, {
      body: JSON.stringify({ expectedTripRevision: 2, orderIndex: 0 }),
      headers: authenticatedHeaders,
      method: "PATCH",
    });
    expect(reordered.status).toBe(200);
    expect(updateItem).toHaveBeenCalledWith(
      userId,
      tripId,
      itemId,
      { expectedTripRevision: 2, orderIndex: 0 },
      { correlationId: requestId },
    );

    const deleted = await app.request(`/trips/${tripId}/items/${itemId}`, {
      body: JSON.stringify({ expectedTripRevision: 3 }),
      headers: authenticatedHeaders,
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(deleteItem).toHaveBeenCalledWith(
      userId,
      tripId,
      itemId,
      { expectedTripRevision: 3 },
      { correlationId: requestId },
    );

    const staleApp = testApp(
      repositoryWith({ updateItem: () => Promise.reject(new TripConcurrencyError()) }),
    );
    const stale = await staleApp.request(`/trips/${tripId}/items/${itemId}`, {
      body: JSON.stringify({ expectedTripRevision: 2, notes: "Concurrent edit" }),
      headers: authenticatedHeaders,
      method: "PATCH",
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: "conflict" } });
  });
});
