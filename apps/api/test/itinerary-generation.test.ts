import type { ItineraryGenerationSummary } from "@roavia/contracts";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { ItineraryGenerationApiService } from "../src/itinerary-generation.js";

const authUserId = "10000000-0000-4000-8000-000000000001";
const tripId = "20000000-0000-4000-8000-000000000001";
const runId = "30000000-0000-4000-8000-000000000001";
const jobId = "40000000-0000-4000-8000-000000000001";
const requestId = "50000000-0000-4000-8000-000000000001";

const summary: ItineraryGenerationSummary = {
  assumptions: [],
  completedAt: null,
  createdAt: "2026-07-29T00:00:00.000Z",
  failureCode: null,
  groundingStatus: null,
  id: runId,
  maxRepairAttempts: 2,
  overallConfidence: null,
  repairAttempts: 0,
  sources: [],
  status: "queued",
  tripRevision: 4,
  warnings: [],
};

function app(service?: ItineraryGenerationApiService) {
  return createApp({
    itineraryGenerationService: service,
    verifyAccessToken: async () => ({
      expiresAt: "2026-07-29T01:00:00.000Z",
      identity: { userId: authUserId },
    }),
  });
}

function generationServiceFixture(): ItineraryGenerationApiService {
  return {
    cancelGeneration: vi
      .fn<NonNullable<ItineraryGenerationApiService["cancelGeneration"]>>()
      .mockResolvedValue({ generationRunId: runId, jobId, status: "cancelled" }),
    getGeneration: vi
      .fn<ItineraryGenerationApiService["getGeneration"]>()
      .mockResolvedValue(summary),
    requestGeneration: vi
      .fn<ItineraryGenerationApiService["requestGeneration"]>()
      .mockResolvedValue({
        generationRunId: runId,
        jobId,
        status: "queued",
        tripRevision: 4,
      }),
  };
}

const headers = {
  authorization: "Bearer test-token",
  "content-type": "application/json",
  "x-request-id": requestId,
};

describe("itinerary generation API routes", () => {
  test("authenticates before reporting generation service availability", async () => {
    const api = app();
    const unauthenticated = await api.request(`/trips/${tripId}/generation`);
    const unavailable = await api.request(`/trips/${tripId}/generation`, { headers });

    expect(unauthenticated.status).toBe(401);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: { code: "generation_service_unavailable" },
    });
  });

  test("queues generate and regenerate requests with revision and correlation", async () => {
    const generationService = generationServiceFixture();
    const api = app(generationService);

    for (const action of ["generate", "regenerate"]) {
      const response = await api.request(`/trips/${tripId}/${action}`, {
        body: JSON.stringify({ expectedTripRevision: 3 }),
        headers,
        method: "POST",
      });
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        data: { generationRunId: runId, jobId, status: "queued", tripRevision: 4 },
        meta: { requestId },
      });
    }

    expect(generationService.requestGeneration).toHaveBeenCalledTimes(2);
    expect(generationService.requestGeneration).toHaveBeenCalledWith(
      authUserId,
      tripId,
      { expectedTripRevision: 3 },
      { correlationId: requestId },
    );
  });

  test("returns current stages and rejects malformed requests", async () => {
    const generationService = generationServiceFixture();
    const api = app(generationService);
    const invalid = await api.request(`/trips/${tripId}/generate`, {
      body: JSON.stringify({ expectedTripRevision: 0 }),
      headers,
      method: "POST",
    });
    const status = await api.request(`/trips/${tripId}/generation`, { headers });

    expect(invalid.status).toBe(400);
    expect(generationService.requestGeneration).not.toHaveBeenCalled();
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      data: { id: runId, status: "queued", tripRevision: 4 },
    });
    expect(generationService.getGeneration).toHaveBeenCalledWith(authUserId, tripId);
  });

  test("cancels only a validated owned generation reference", async () => {
    const generationService = generationServiceFixture();
    const api = app(generationService);
    const response = await api.request(`/trips/${tripId}/generation/cancel`, {
      body: JSON.stringify({ generationRunId: runId, jobId }),
      headers,
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { generationRunId: runId, jobId, status: "cancelled" },
      meta: { requestId },
    });
    expect(generationService.cancelGeneration).toHaveBeenCalledWith(authUserId, tripId, {
      generationRunId: runId,
      jobId,
    });
  });
});
