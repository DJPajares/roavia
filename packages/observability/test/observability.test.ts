import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  RuntimeObservability,
  authorizeMetricsRequest,
  createTraceContext,
  evaluateAlertRules,
  readObservabilityConfig,
  validateAlertRules,
  validateDashboardManifest,
  type AlertRule,
  type DashboardManifest,
} from "../src/index.js";

const metricsToken = "metrics-token-with-at-least-32-characters";

function fixture() {
  const lines: string[] = [];
  const observability = new RuntimeObservability({
    clock: () => new Date("2026-08-02T00:00:00.000Z"),
    environment: "test",
    releaseSha: "release-123",
    service: "roavia-test",
    sink: (line) => lines.push(line),
  });
  return { lines, observability };
}

describe("privacy-safe runtime observability", () => {
  test("drops unknown fields and redacts content-bearing values", () => {
    const { lines, observability } = fixture();
    observability.logger.log({
      event: "request",
      level: "error",
      operation: "trip.refresh",
      prompt: "Plan 2026-08-10 with Bearer super-secret-token",
      provider: "person@example.test",
    } as never);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      environment: "test",
      event: "request",
      level: "error",
      operation: "trip.refresh",
      provider: "[REDACTED]",
      releaseSha: "release-123",
      service: "roavia-test",
      timestamp: "2026-08-02T00:00:00.000Z",
    });
    expect(lines[0]).not.toContain("prompt");
    expect(lines[0]).not.toContain("super-secret-token");
  });

  test("records representative failures as content-free metrics and alerts", () => {
    const { lines, observability } = fixture();
    const sensitive = "traveler@example.test is at 1.3000,103.8000 on 2026-08-10";

    observability.apiRequestStarted({
      correlationId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
      method: "POST",
      route: "/trips/:tripId/generate",
      traceId: "0123456789abcdef0123456789abcdef",
    });
    for (let index = 0; index < 5; index += 1) {
      observability.recordApiRequest({
        correlationId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
        durationMs: 75,
        errorCode: "internal_error",
        method: "POST",
        route: "/trips/:tripId/generate",
        statusCode: 500,
        traceId: "0123456789abcdef0123456789abcdef",
      });
    }
    observability.recordJob({
      attempt: 3,
      correlationId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
      event: "dead_lettered",
      jobId: "75e955ca-0ad0-4c0d-b8bf-cb265eea466e",
      subjectId: "trip-123",
      type: "itinerary.generate.v1",
    });
    observability.recordJobHealth(
      [
        {
          availableAt: new Date("2026-08-01T23:50:00.000Z"),
          status: "retrying",
          type: "itinerary.generate.v1",
        },
      ],
      [
        {
          availableAt: new Date("2026-08-01T23:45:00.000Z"),
          completedAt: new Date("2026-08-01T23:55:00.000Z"),
          status: "dead_lettered",
          type: "itinerary.generate.v1",
        },
      ],
    );
    observability.recordProvider({
      dataClass: "weather_forecast",
      errorCode: "quota_exhausted",
      event: "provider_attempt",
      operation: "weather.forecast",
      provider: "open-meteo",
      requestId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
      resultStatus: "quota",
      usageCostUnits: 2,
    });
    observability.recordProvider({
      cacheOutcome: "stale",
      dataClass: "weather_forecast",
      event: "cache",
      operation: "weather.forecast",
      provider: "open-meteo",
      requestId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
      resultStatus: "stale",
    });
    observability.recordAiGeneration({
      durationMs: 1_500,
      errorCode: "provider_unavailable",
      model: "openai/gpt-test",
      operation: "itinerary",
      outcome: "error",
      provider: "gateway",
      requestId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
    });
    observability.recordAiQuality({
      correlationId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
      operation: "itinerary",
      outcome: "rejected",
      repairCount: 1,
      validationFailureCount: 2,
    });
    observability.recordAiAction({
      actionCount: 1,
      correlationId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
      outcome: "failed",
    });
    observability.recordOffline({
      correlationId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
      durationMs: 900,
      errorCode: sensitive,
      outcome: "error",
      traceId: "0123456789abcdef0123456789abcdef",
    });

    expect(observability.metrics.sum("roavia_api_requests_total", { status_class: "5xx" })).toBe(5);
    expect(observability.metrics.sum("roavia_provider_events_total", { status: "quota" })).toBe(1);
    expect(observability.metrics.sum("roavia_provider_usage_cost_units_total")).toBe(2);
    expect(
      observability.metrics.sum("roavia_data_freshness_events_total", { state: "stale" }),
    ).toBe(1);
    expect(observability.metrics.sum("roavia_ai_unpriced_generations_total")).toBe(1);
    expect(observability.metrics.sum("roavia_job_queue_depth", { status: "retrying" })).toBe(1);
    expect(observability.metrics.sum("roavia_job_oldest_age_seconds", { status: "retrying" })).toBe(
      600,
    );
    expect(observability.metrics.sum("roavia_job_dead_letters")).toBe(1);
    expect(
      observability.metrics.sum("roavia_offline_generations_total", { outcome: "error" }),
    ).toBe(1);
    expect(lines.join("\n")).not.toContain("traveler@example.test");
    expect(lines.join("\n")).not.toContain("2026-08-10");
    expect(lines.join("\n")).not.toContain("1.3000");
    expect(lines.join("\n")).toContain('"event":"job_health_snapshot"');
    expect(lines.join("\n")).toContain('"event":"job_dead_letter_snapshot"');

    const firing = evaluateAlertRules(observability.metrics, [
      {
        comparator: "gte",
        description: "API failures",
        id: "api-server-errors",
        labels: { status_class: "5xx" },
        metric: "roavia_api_requests_total",
        runbook: "docs/operations/observability.md#api-server-errors",
        severity: "critical",
        threshold: 5,
        windowMinutes: 10,
      },
    ]);
    expect(firing).toEqual([
      expect.objectContaining({ id: "api-server-errors", observedValue: 5 }),
    ]);
  });

  test("exports valid OpenMetrics without sensitive dimensions", () => {
    const { observability } = fixture();
    observability.recordOffline({
      correlationId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
      durationMs: 25,
      outcome: "success",
      reused: false,
      sizeBytes: 1_024,
      traceId: "0123456789abcdef0123456789abcdef",
    });
    const output = observability.metrics.renderOpenMetrics();
    expect(output).toContain("# TYPE roavia_offline_generations_total counter");
    expect(output).toContain(
      'roavia_offline_generations_total{outcome="success",reused="false"} 1',
    );
    expect(output).toContain("# EOF");
    expect(output).not.toContain("correlationId");
  });
});

describe("configuration and manifests", () => {
  test("enforces retention, metrics authentication, and W3C trace continuity", () => {
    expect(
      readObservabilityConfig({
        NODE_ENV: "production",
        OBSERVABILITY_AGGREGATED_RETENTION_DAYS: "395",
        OBSERVABILITY_METRICS_TOKEN: metricsToken,
        OBSERVABILITY_RAW_RETENTION_DAYS: "30",
        RENDER_GIT_COMMIT: "abc123",
      }),
    ).toEqual({
      aggregatedRetentionDays: 395,
      environment: "production",
      metricsToken,
      rawRetentionDays: 30,
      releaseSha: "abc123",
    });
    expect(() => readObservabilityConfig({ OBSERVABILITY_RAW_RETENTION_DAYS: "31" })).toThrow(
      /1 to 30/,
    );
    expect(authorizeMetricsRequest(`Bearer ${metricsToken}`, metricsToken)).toBe(true);
    expect(authorizeMetricsRequest("Bearer wrong-token", metricsToken)).toBe(false);

    const trace = createTraceContext("00-0123456789abcdef0123456789abcdef-0123456789abcdef-01");
    expect(trace.traceId).toBe("0123456789abcdef0123456789abcdef");
    expect(trace.traceparent).toMatch(/^00-0123456789abcdef0123456789abcdef-[0-9a-f]{16}-01$/);
  });

  test("validates the checked-in dashboard, alerts, and runbook links", async () => {
    const dashboard = JSON.parse(
      await readFile(new URL("../../../ops/observability/dashboard.json", import.meta.url), "utf8"),
    ) as DashboardManifest;
    const alerts = JSON.parse(
      await readFile(new URL("../../../ops/observability/alerts.json", import.meta.url), "utf8"),
    ) as AlertRule[];
    const runbook = await readFile(
      new URL("../../../docs/operations/observability.md", import.meta.url),
      "utf8",
    );

    expect(validateDashboardManifest(dashboard).referencedMetrics).toEqual(
      expect.arrayContaining([
        "roavia_api_requests_total",
        "roavia_job_dead_letters",
        "roavia_provider_events_total",
        "roavia_ai_cost_micros_total",
        "roavia_offline_generations_total",
      ]),
    );
    expect(validateAlertRules(alerts)).toHaveLength(12);
    for (const alert of alerts) {
      expect(runbook.toLowerCase()).toContain(
        `## ${alert.runbook.split("#").at(-1)!.replaceAll("-", " ")}`,
      );
    }
  });
});
