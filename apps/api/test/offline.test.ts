import type { OfflinePackageRecord } from "@roavia/contracts";
import type { OfflinePackageRepository } from "@roavia/db";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "../src/app.js";

const tripId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";

const packageRecord: OfflinePackageRecord = {
  expiresAt: null,
  generatedAt: "2026-07-29T12:00:00.000Z",
  id: "44444444-4444-4444-8444-444444444444",
  manifest: {
    contentHash: "a".repeat(64),
    generatedAt: "2026-07-29T12:00:00.000Z",
    guidance: [],
    licensing: { excludedContent: [] },
    liveData: {
      assistantResponses: "unavailable_offline",
      bookingAvailability: "unavailable_offline",
      closures: "unavailable_offline",
      prices: "unavailable_offline",
      weather: "unavailable_offline",
    },
    packageVersion: 1,
    schemaVersion: 1,
    sizeBytes: 456,
    trip: {
      days: [],
      destinations: [],
      endDate: "2026-10-06",
      id: tripId,
      revision: 1,
      startDate: "2026-10-01",
      title: "Offline trip",
    },
  },
  sizeBytes: 456,
  tripId,
  version: 1,
};

function authenticatedApp(repository: OfflinePackageRepository) {
  return createApp({
    offlinePackageRepository: repository,
    verifyAccessToken: async () => ({
      expiresAt: "2026-07-30T12:00:00.000Z",
      identity: { userId },
    }),
  });
}

function headers() {
  return { authorization: "Bearer test", "x-request-id": requestId };
}

describe("offline package API", () => {
  test("creates, reuses, and retrieves an authenticated package", async () => {
    const generate = vi
      .fn<OfflinePackageRepository["generate"]>()
      .mockResolvedValueOnce({ package: packageRecord, reused: false })
      .mockResolvedValueOnce({ package: packageRecord, reused: true });
    const repository: OfflinePackageRepository = {
      generate,
      getLatest: vi.fn<OfflinePackageRepository["getLatest"]>().mockResolvedValue(packageRecord),
    };
    const app = authenticatedApp(repository);

    const created = await app.request(`/trips/${tripId}/offline-package`, {
      headers: headers(),
      method: "POST",
    });
    const reused = await app.request(`/trips/${tripId}/offline-package`, {
      headers: headers(),
      method: "POST",
    });
    const retrieved = await app.request(`/trips/${tripId}/offline-package`, {
      headers: headers(),
    });

    expect(created.status).toBe(201);
    expect(reused.status).toBe(200);
    expect(retrieved.status).toBe(200);
    await expect(reused.json()).resolves.toMatchObject({ data: { reused: true } });
    await expect(retrieved.json()).resolves.toMatchObject({
      data: { package: { tripId, version: 1 } },
    });
    expect(generate).toHaveBeenCalledWith(userId, tripId, { now: expect.any(Date) });
  });

  test("requires authentication and hides missing package state", async () => {
    const repository: OfflinePackageRepository = {
      generate: vi.fn<OfflinePackageRepository["generate"]>(),
      getLatest: vi.fn<OfflinePackageRepository["getLatest"]>().mockResolvedValue(null),
    };
    const app = authenticatedApp(repository);

    expect((await app.request(`/trips/${tripId}/offline-package`)).status).toBe(401);
    expect(
      (await app.request(`/trips/${tripId}/offline-package`, { headers: headers() })).status,
    ).toBe(404);
  });
});
