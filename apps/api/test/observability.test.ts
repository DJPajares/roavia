import { RuntimeObservability } from "@roavia/observability";
import type { OfflinePackageRepository } from "@roavia/db";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "../src/app.js";

const requestId = "46edbf9d-5c17-4f45-9287-69a39450a9dc";
const traceId = "0123456789abcdef0123456789abcdef";
const traceparent = `00-${traceId}-0123456789abcdef-01`;
const metricsToken = "metrics-token-with-at-least-32-characters";

function fixture() {
  const lines: string[] = [];
  const observability = new RuntimeObservability({
    environment: "test",
    releaseSha: "release-123",
    service: "roavia-api",
    sink: (line) => lines.push(line),
  });
  return { lines, observability };
}

describe("API observability", () => {
  test("correlates requests, continues traces, and protects content-free metrics", async () => {
    const { lines, observability } = fixture();
    const app = createApp({ metricsToken, observability });

    const health = await app.request("/health", {
      headers: { traceparent, "x-request-id": requestId },
    });
    expect(health.status).toBe(200);
    expect(health.headers.get("x-request-id")).toBe(requestId);
    expect(health.headers.get("traceparent")).toMatch(
      new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`),
    );

    const unauthorized = await app.request("/internal/metrics");
    expect(unauthorized.status).toBe(401);
    const metrics = await app.request("/internal/metrics", {
      headers: { authorization: `Bearer ${metricsToken}` },
    });
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get("content-type")).toContain("application/openmetrics-text");
    const body = await metrics.text();
    expect(body).toContain(
      'roavia_api_requests_total{method="GET",route="/health",status_class="2xx",outcome="success"} 1',
    );
    expect(body).not.toContain(requestId);
    expect(body).not.toContain(traceId);

    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correlationId: requestId,
          event: "request_started",
          operation: "request.pending",
          traceId,
        }),
        expect.objectContaining({
          correlationId: requestId,
          event: "request_completed",
          operation: "/health",
          outcome: "success",
          statusCode: 200,
          traceId,
        }),
      ]),
    );
  });

  test("records thrown failures without logging queries, credentials, dates, or provider payloads", async () => {
    const { lines, observability } = fixture();
    const sensitive =
      "traveler@example.test requested 2026-08-10 at latitude=1.3000 with Bearer secret-token";
    const app = createApp({
      observability,
      searchDestinations: () => Promise.reject(new Error(sensitive)),
    });

    const response = await app.request(
      "/destinations/search?q=traveler%40example.test%202026-08-10&limit=5",
      { headers: { "x-request-id": requestId } },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "internal_error",
        message: "An unexpected error occurred.",
        requestId,
      },
    });

    const output = lines.join("\n");
    expect(output).not.toContain("traveler@example.test");
    expect(output).not.toContain("2026-08-10");
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("latitude");
    expect(output).toContain('"route":"/destinations/search"');
    expect(observability.metrics.sum("roavia_api_requests_total", { status_class: "5xx" })).toBe(1);
  });

  test("does not expose the internal metrics route without server configuration", async () => {
    const { observability } = fixture();
    const response = await createApp({ observability }).request("/internal/metrics");
    expect(response.status).toBe(404);
  });

  test("records offline generation failures through the real route boundary", async () => {
    const { observability } = fixture();
    const repository: OfflinePackageRepository = {
      generate: vi
        .fn<OfflinePackageRepository["generate"]>()
        .mockRejectedValue(
          new Error("Trip changed repeatedly while generating its offline package."),
        ),
      getLatest: vi.fn<OfflinePackageRepository["getLatest"]>(),
    };
    const app = createApp({
      observability,
      offlinePackageRepository: repository,
      verifyAccessToken: async () => ({
        expiresAt: "2026-08-02T01:00:00.000Z",
        identity: { userId: "22222222-2222-4222-8222-222222222222" },
      }),
    });
    const response = await app.request(
      "/trips/11111111-1111-4111-8111-111111111111/offline-package",
      {
        headers: { authorization: "Bearer test", "x-request-id": requestId },
        method: "POST",
      },
    );

    expect(response.status).toBe(500);
    expect(
      observability.metrics.sum("roavia_offline_generations_total", { outcome: "error" }),
    ).toBe(1);
    expect(
      observability.metrics.sum("roavia_api_requests_total", {
        route: "/trips/:tripId/offline-package",
        status_class: "5xx",
      }),
    ).toBe(1);
  });
});
