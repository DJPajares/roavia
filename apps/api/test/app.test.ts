import { apiErrorResponseSchema, healthResponseSchema } from "@roavia/contracts";
import { describe, expect, test } from "vitest";

import { app } from "../src/app.js";

describe("Roavia API", () => {
  test("returns a typed health response and request ID", async () => {
    const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
    const response = await app.request("/health", {
      headers: { "x-request-id": requestId },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(requestId);

    const body = healthResponseSchema.parse(await response.json());
    expect(body).toEqual({
      data: { service: "api", status: "ok", version: "v1" },
      meta: { requestId },
    });
  });

  test("uses the standard error envelope for unknown routes", async () => {
    const response = await app.request("/missing");

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const body = apiErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe("not_found");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });
});
