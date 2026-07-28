import { apiErrorResponseSchema } from "@roavia/contracts";
import { describe, expect, test } from "vitest";

import { app } from "../../../apps/api/src/app.js";
import { createApp } from "../../../apps/api/src/app.js";
import { createRoaviaApiClient } from "../src/index.js";

const trip = {
  budget: { amountMinor: 250_000, currency: "SGD", style: "midrange" as const },
  createdAt: "2026-07-28T10:00:00.000Z",
  dateFlexibility: { daysAfter: 0, daysBefore: 0 },
  endDate: "2026-08-06",
  generationState: "ready" as const,
  id: "11111111-1111-4111-8111-111111111111",
  originPlaceId: null,
  revision: 3,
  slug: "singapore-escape",
  startDate: "2026-08-01",
  status: "active" as const,
  title: "Singapore escape",
  travelerSummary: { adults: 2, children: 0, infants: 0 },
  updatedAt: "2026-07-28T10:00:00.000Z",
  visibility: "private" as const,
};

describe("Roavia API client", () => {
  test("calls the API health endpoint through the shared contract", async () => {
    const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
    const client = createRoaviaApiClient({
      baseUrl: "https://api.roavia.test",
      fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
      requestId: () => requestId,
    });

    await expect(client.health()).resolves.toEqual({
      data: { service: "api", status: "ok", version: "v1" },
      meta: { requestId },
    });
  });

  test("surfaces standardized API errors without duplicating error types", async () => {
    const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
    const error = apiErrorResponseSchema.parse({
      error: {
        code: "not_found",
        message: "Route not found.",
        requestId,
      },
    });
    const client = createRoaviaApiClient({
      baseUrl: "https://api.roavia.test",
      fetch: async () => Response.json(error, { status: 404 }),
      requestId: () => requestId,
    });

    await expect(client.health()).rejects.toMatchObject({
      code: "not_found",
      requestId,
      status: 404,
    });
  });

  test("passes the access token and parses the normalized session", async () => {
    const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
    const authenticatedApp = createApp({
      verifyAccessToken: async (accessToken) => {
        expect(accessToken).toBe("valid-access-token");
        return {
          identity: {
            email: "traveler@roavia.test",
            userId: "11111111-1111-4111-8111-111111111111",
          },
          expiresAt: "2030-01-01T00:00:00.000Z",
        };
      },
    });
    const client = createRoaviaApiClient({
      accessToken: () => "valid-access-token",
      baseUrl: "https://api.roavia.test",
      fetch: (input, init) => Promise.resolve(authenticatedApp.fetch(new Request(input, init))),
      requestId: () => requestId,
    });

    await expect(client.session()).resolves.toEqual({
      data: {
        identity: {
          email: "traveler@roavia.test",
          userId: "11111111-1111-4111-8111-111111111111",
        },
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
      meta: { requestId },
    });
  });

  test("sends authenticated profile updates through the shared contract", async () => {
    const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
    const client = createRoaviaApiClient({
      accessToken: () => "valid-access-token",
      baseUrl: "https://api.roavia.test",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        expect(request.method).toBe("PATCH");
        expect(request.headers.get("authorization")).toBe("Bearer valid-access-token");
        expect(request.headers.get("content-type")).toBe("application/json");
        const body = await request.json();
        expect(body).toEqual({ defaultPace: "slow" });
        return Response.json({
          data: {
            accessibilityNeeds: [],
            defaultBudgetStyle: "midrange",
            defaultPace: "slow",
            dietaryNeeds: [],
            email: "traveler@roavia.test",
            homeCountry: null,
            interests: [],
            locale: "en",
            preferredCurrency: "USD",
            timezone: "UTC",
            travelPreferences: { mustAvoid: [], mustDo: [] },
            updatedAt: "2026-07-28T10:00:00.000Z",
          },
          meta: { requestId },
        });
      },
      requestId: () => requestId,
    });

    await expect(client.updateProfile({ defaultPace: "slow" })).resolves.toMatchObject({
      data: { defaultPace: "slow" },
    });
  });

  test("lists owner-scoped trips with normalized lifecycle filters", async () => {
    const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
    const client = createRoaviaApiClient({
      accessToken: () => "valid-access-token",
      baseUrl: "https://api.roavia.test",
      fetch: (input, init) => {
        const request = new Request(input, init);
        expect(request.headers.get("authorization")).toBe("Bearer valid-access-token");
        expect(request.method).toBe("GET");
        expect(request.url).toBe(
          "https://api.roavia.test/trips?limit=10&cursor=next-page&status=active",
        );
        return Promise.resolve(
          Response.json({
            data: { pagination: { limit: 10, nextCursor: null }, trips: [trip] },
            meta: { requestId },
          }),
        );
      },
      requestId: () => requestId,
    });

    await expect(
      client.listTrips({ cursor: "next-page", limit: 10, status: "active" }),
    ).resolves.toMatchObject({ data: { trips: [{ id: trip.id }] } });
  });

  test("deletes a trip with its expected revision", async () => {
    const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
    const client = createRoaviaApiClient({
      accessToken: () => "valid-access-token",
      baseUrl: "https://api.roavia.test",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        expect(request.headers.get("authorization")).toBe("Bearer valid-access-token");
        expect(request.method).toBe("DELETE");
        expect(await request.json()).toEqual({ expectedRevision: 3 });
        return Response.json({ data: { deletedId: trip.id }, meta: { requestId } });
      },
      requestId: () => requestId,
    });

    await expect(client.deleteTrip(trip.id, { expectedRevision: 3 })).resolves.toEqual({
      data: { deletedId: trip.id },
      meta: { requestId },
    });
  });

  test("surfaces a normalized missing-session error", async () => {
    const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
    const authenticatedApp = createApp();
    const client = createRoaviaApiClient({
      baseUrl: "https://api.roavia.test",
      fetch: (input, init) => Promise.resolve(authenticatedApp.fetch(new Request(input, init))),
      requestId: () => requestId,
    });

    await expect(client.session()).rejects.toMatchObject({
      code: "authentication_required",
      requestId,
      status: 401,
    });
  });

  test("serializes destination search filters and parses the shared response", async () => {
    const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
    const regionId = "22222222-2222-4222-8222-222222222222";
    const client = createRoaviaApiClient({
      baseUrl: "https://api.roavia.test",
      fetch: (input, init) => {
        const request = new Request(input, init);
        expect(request.url).toBe(
          `https://api.roavia.test/destinations/search?q=Singapore&page=1&limit=8&country=SG&regionId=${regionId}&type=city`,
        );
        return Promise.resolve(
          Response.json({
            data: {
              query: "Singapore",
              results: [],
              pagination: { page: 1, limit: 8, total: 0, nextPage: null },
            },
            meta: { requestId },
          }),
        );
      },
      requestId: () => requestId,
    });

    await expect(
      client.searchDestinations({
        query: "Singapore",
        page: 1,
        limit: 8,
        types: ["city"],
        country: "SG",
        regionId,
      }),
    ).resolves.toMatchObject({ data: { query: "Singapore" } });
  });
});
