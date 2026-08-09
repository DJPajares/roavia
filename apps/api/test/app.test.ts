import {
  apiErrorResponseSchema,
  healthResponseSchema,
  readinessResponseSchema,
} from "@roavia/contracts";
import { describe, expect, test } from "vitest";

import { app, createApp } from "../src/app.js";

describe("Roavia API", () => {
  test("returns a typed health response and request ID", async () => {
    const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
    const response = await app.request("/health", {
      headers: { "x-request-id": requestId },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");

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

  test("reports runtime readiness without exposing dependency details", async () => {
    const ready = createApp({ readiness: () => Promise.resolve() });
    const readyResponse = await ready.request("/ready");

    expect(readyResponse.status).toBe(200);
    expect(readinessResponseSchema.parse(await readyResponse.json()).data).toEqual({
      checks: { database: "ok", queue: "ok" },
      service: "api",
      status: "ready",
      version: "v1",
    });

    const unavailableResponse = await app.request("/ready");
    expect(unavailableResponse.status).toBe(503);
    expect(readinessResponseSchema.parse(await unavailableResponse.json()).data).toEqual({
      checks: { database: "unavailable", queue: "unavailable" },
      service: "api",
      status: "unavailable",
      version: "v1",
    });
  });

  test("rejects oversized request bodies before route parsing", async () => {
    const limited = createApp({ maxRequestBodyBytes: 16 });
    const response = await limited.request("/missing", {
      body: JSON.stringify({ value: "payload larger than sixteen bytes" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(413);
    const body = apiErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe("payload_too_large");
  });
});
