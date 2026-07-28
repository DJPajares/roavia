import { apiErrorResponseSchema } from "@roavia/contracts";
import { describe, expect, test } from "vitest";

import { app } from "../../../apps/api/src/app.js";
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
});
