import type { ShareRepository } from "@roavia/db";
import { AuthorizedResourceNotFoundError } from "@roavia/db";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "../src/app.js";

const userId = "11111111-1111-4111-8111-111111111111";
const tripId = "22222222-2222-4222-8222-222222222222";
const linkId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const token = "A".repeat(43);
const createdAt = "2026-07-28T10:00:00.000Z";
const expiresAt = "2026-08-27T10:00:00.000Z";

const link = {
  id: linkId,
  permission: "view" as const,
  status: "active" as const,
  createdAt,
  expiresAt,
  revokedAt: null,
};

const sharedTrip = {
  title: "Kyoto slow days",
  startDate: "2026-08-01",
  endDate: "2026-08-02",
  updatedAt: createdAt,
  expiresAt,
  days: [],
};

function repositoryWith(overrides: Partial<ShareRepository> = {}): ShareRepository {
  return {
    createLink: vi.fn<ShareRepository["createLink"]>().mockResolvedValue({ link, token }),
    getSharedTrip: vi.fn<ShareRepository["getSharedTrip"]>().mockResolvedValue(sharedTrip),
    listLinks: vi.fn<ShareRepository["listLinks"]>().mockResolvedValue([link]),
    revokeLink: vi
      .fn<ShareRepository["revokeLink"]>()
      .mockResolvedValue({ id: linkId, revokedAt: createdAt }),
    ...overrides,
  } as ShareRepository;
}

function testApp(repository: ShareRepository) {
  return createApp({
    shareRepository: repository,
    verifyAccessToken: async () => ({ expiresAt, identity: { userId } }),
  });
}

describe("trip-sharing API routes", () => {
  test("requires owner authentication for every share-link mutation", async () => {
    const app = testApp(repositoryWith());
    const create = await app.request(`/trips/${tripId}/share-links`, {
      body: JSON.stringify({ expiresInDays: 30 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const revoke = await app.request(`/trips/${tripId}/share-links/${linkId}`, {
      method: "DELETE",
    });
    expect(create.status).toBe(401);
    expect(revoke.status).toBe(401);
  });

  test("creates finite links with owner identity and audit correlation", async () => {
    const createLink = vi.fn<ShareRepository["createLink"]>().mockResolvedValue({ link, token });
    const app = testApp(repositoryWith({ createLink }));
    const response = await app.request(`/trips/${tripId}/share-links`, {
      body: JSON.stringify({ expiresInDays: 90 }),
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
        "x-request-id": requestId,
      },
      method: "POST",
    });
    expect(response.status).toBe(201);
    expect(createLink).toHaveBeenCalledWith(
      userId,
      tripId,
      { expiresInDays: 90 },
      { correlationId: requestId },
    );
    await expect(response.json()).resolves.toMatchObject({ data: { link: { id: linkId }, token } });
  });

  test("serves only public shared-trip data with private cache and indexing headers", async () => {
    const getSharedTrip = vi.fn<ShareRepository["getSharedTrip"]>().mockResolvedValue(sharedTrip);
    const app = testApp(repositoryWith({ getSharedTrip }));
    const response = await app.request(`/shared-trips/${token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(getSharedTrip).toHaveBeenCalledWith(token);
  });

  test("returns the same generic response for invalid, expired, or revoked links", async () => {
    const app = testApp(
      repositoryWith({
        getSharedTrip: vi
          .fn<ShareRepository["getSharedTrip"]>()
          .mockRejectedValue(new AuthorizedResourceNotFoundError()),
      }),
    );
    const invalid = await app.request("/shared-trips/not-a-token");
    const unavailable = await app.request(`/shared-trips/${token}`);
    expect(invalid.status).toBe(404);
    expect(unavailable.status).toBe(404);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "not_found", message: "Resource not found." },
    });
    await expect(unavailable.json()).resolves.toMatchObject({
      error: { code: "not_found", message: "Resource not found." },
    });
  });
});
