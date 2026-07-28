import { apiErrorResponseSchema } from "@roavia/contracts";
import { describe, expect, test } from "vitest";

import { app } from "../../../apps/api/src/app.js";
import { createApp } from "../../../apps/api/src/app.js";
import { createRoaviaApiClient } from "../src/index.js";

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
});
