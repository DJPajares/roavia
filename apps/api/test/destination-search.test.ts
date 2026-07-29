import { destinationSearchResponseSchema } from "@roavia/contracts";
import { describe, expect, test } from "vitest";

import { createApp } from "../src/app.js";
import { createFixedWindowRateLimiter } from "../src/rate-limit.js";

const countryId = "11111111-1111-4111-8111-111111111111";
const regionId = "22222222-2222-4222-8222-222222222222";
const cityId = "33333333-3333-4333-8333-333333333333";
const contentId = "44444444-4444-4444-8444-444444444444";
const sourceId = "55555555-5555-4555-8555-555555555555";

describe("destination search API", () => {
  test("returns only structured, source-aware destination detail", async () => {
    const app = createApp({
      getDestinationDetail: async (placeId) => {
        expect(placeId).toBe(cityId);
        return {
          place: {
            id: cityId,
            canonicalName: "Singapore",
            localizedNames: {},
            placeType: "city",
            countryCode: "SG",
            timezone: "Asia/Singapore",
            summary: "A curated launch destination.",
            hierarchy: [{ id: countryId, name: "Singapore", type: "country" }],
          },
          content: [
            {
              id: contentId,
              type: "practical",
              data: { currency: "Singapore dollar" },
              freshness: "fresh",
              refreshedAt: "2026-07-29T00:00:00.000Z",
              sources: [
                {
                  id: sourceId,
                  title: "Visit Singapore",
                  url: "https://www.visitsingapore.com/",
                  kind: "official_authority",
                  attribution: "Source: Visit Singapore",
                  license: "official-site-terms",
                  licenseUrl: "https://www.visitsingapore.com/terms-of-use/",
                  retrievedAt: "2026-07-29T00:00:00.000Z",
                },
              ],
            },
          ],
        };
      },
    });
    const response = await app.request(`/destinations/${cityId}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        place: { canonicalName: "Singapore" },
        content: [{ sources: [{ kind: "official_authority" }] }],
      },
    });
  });

  test("validates, forwards filters, and returns the typed paginated response", async () => {
    const app = createApp({
      searchDestinations: async (query) => {
        expect(query).toEqual({
          query: "Singapore",
          page: 2,
          limit: 5,
          types: ["city"],
          country: "SG",
          regionId,
        });
        return {
          query: query.query,
          results: [
            {
              id: cityId,
              canonicalName: "Singapore",
              localizedNames: { zh: "新加坡" },
              placeType: "city",
              countryCode: "SG",
              hierarchy: [
                { id: countryId, name: "Singapore", type: "country" },
                { id: regionId, name: "Central Region", type: "region" },
              ],
            },
          ],
          pagination: { page: 2, limit: 5, total: 6, nextPage: 3 },
        };
      },
    });
    const response = await app.request(
      `/destinations/search?q=Singapore&page=2&limit=5&type=city&country=sg&regionId=${regionId}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-limit")).toBe("60");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(destinationSearchResponseSchema.parse(await response.json())).toMatchObject({
      data: { pagination: { nextPage: 3, total: 6 } },
    });
  });

  test("allows the configured Roavia web origin to call public search", async () => {
    const app = createApp({
      searchDestinations: async (query) => ({
        query: query.query,
        results: [],
        pagination: { page: query.page, limit: query.limit, total: 0, nextPage: null },
      }),
    });
    const response = await app.request("/destinations/search?q=Singapore", {
      headers: { origin: "http://localhost:3000" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  test("rejects invalid input without calling the search handler", async () => {
    const app = createApp({
      searchDestinations: async () => {
        throw new Error("Invalid requests must not reach the search handler.");
      },
    });
    const response = await app.request("/destinations/search?q=&limit=26");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "bad_request" } });
  });

  test("defines a per-client rate limit for public destination search", async () => {
    const app = createApp({
      searchDestinations: async (query) => ({
        query: query.query,
        results: [],
        pagination: { page: query.page, limit: query.limit, total: 0, nextPage: null },
      }),
      searchRateLimiter: createFixedWindowRateLimiter({ limit: 1, windowMs: 60_000 }),
    });
    const headers = { "x-forwarded-for": "198.51.100.10" };

    expect((await app.request("/destinations/search?q=Singapore", { headers })).status).toBe(200);
    const limited = await app.request("/destinations/search?q=Singapore", { headers });

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    await expect(limited.json()).resolves.toMatchObject({ error: { code: "rate_limited" } });
  });

  test("keeps health available when the catalogue connection is not configured", async () => {
    const app = createApp();
    const response = await app.request("/destinations/search?q=Singapore");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "search_unavailable" } });
  });
});
