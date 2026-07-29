import type { TripIntentExtraction } from "@roavia/contracts";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { TripPlannerApiService } from "../src/trip-planner.js";

const authUserId = "10000000-0000-4000-8000-000000000001";
const requestId = "50000000-0000-4000-8000-000000000001";
const placeId = "60000000-0000-4000-8000-000000000001";

const extraction: TripIntentExtraction = {
  assumptions: [],
  intent: {
    budget: { amountMinor: null, currency: "SGD", style: "budget" },
    constraints: { accessibility: [], dietary: [], mustAvoid: [], mustDo: [] },
    dateFlexibility: { daysAfter: 0, daysBefore: 0 },
    destinations: [
      {
        candidates: [
          {
            canonicalName: "Singapore",
            countryCode: "SG",
            hierarchy: [],
            id: placeId,
            localizedNames: {},
            placeType: "country",
          },
        ],
        query: "Singapore",
        selectedPlaceId: placeId,
      },
    ],
    endDate: "2026-08-12",
    interests: ["food"],
    pace: "balanced",
    startDate: "2026-08-10",
    title: "Singapore break",
    travelers: { adults: 1, children: 0, infants: 0 },
  },
  issues: [],
  status: "ready",
};

const headers = {
  authorization: "Bearer test-token",
  "content-type": "application/json",
  "x-request-id": requestId,
};

function app(service?: TripPlannerApiService) {
  return createApp({
    tripPlannerService: service,
    verifyAccessToken: async () => ({
      expiresAt: "2026-07-29T01:00:00.000Z",
      identity: { userId: authUserId },
    }),
  });
}

describe("trip planner API", () => {
  test("authenticates and validates before extraction", async () => {
    const unavailable = await app().request("/planner/extract", {
      body: JSON.stringify({ prompt: "Plan a complete trip to Singapore next month." }),
      headers,
      method: "POST",
    });
    const unauthenticated = await app().request("/planner/extract", { method: "POST" });

    expect(unauthenticated.status).toBe(401);
    expect(unavailable.status).toBe(503);
  });

  test("returns editable structured intent without persisting the prompt", async () => {
    const extract = vi.fn<TripPlannerApiService["extract"]>().mockResolvedValue(extraction);
    const response = await app({ extract }).request("/planner/extract", {
      body: JSON.stringify({
        locale: "en-SG",
        prompt: "Plan a budget food trip to Singapore from August 10 to 12 for me.",
        timeZone: "Asia/Singapore",
      }),
      headers,
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: extraction, meta: { requestId } });
    expect(extract).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en-SG", timeZone: "Asia/Singapore" }),
      expect.objectContaining({ authUserId, requestId, signal: expect.any(AbortSignal) }),
    );
  });

  test("preserves retryable extraction failures as a safe service error", async () => {
    const response = await app({
      extract: async () => {
        throw { retryable: true };
      },
    }).request("/planner/extract", {
      body: JSON.stringify({ prompt: "Plan a complete trip to Singapore next month." }),
      headers,
      method: "POST",
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "planner_extraction_failed" },
    });
  });
});
