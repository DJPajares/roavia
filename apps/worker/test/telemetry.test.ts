import { RuntimeObservability } from "@roavia/observability";
import { describe, expect, test, vi } from "vitest";

import { createWorkerJobTelemetry, startAccountRetentionMonitor } from "../src/telemetry.js";

describe("worker telemetry", () => {
  test("contains correlation fields without job payload data", () => {
    const lines: string[] = [];
    const observability = new RuntimeObservability({
      clock: () => new Date("2026-07-28T00:00:00.000Z"),
      environment: "test",
      releaseSha: "abc123",
      service: "roavia-worker",
      sink: (line) => lines.push(line),
    });
    createWorkerJobTelemetry(observability)({
      attempt: 2,
      correlationId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
      event: "retry_scheduled",
      jobId: "75e955ca-0ad0-4c0d-b8bf-cb265eea466e",
      subjectId: "trip-123",
      timestamp: new Date("2026-07-28T00:00:00.000Z"),
      type: "itinerary.generate.v1",
    });

    expect(JSON.parse(lines[0]!)).toEqual({
      attempt: 2,
      correlationId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
      environment: "test",
      event: "retry_scheduled",
      jobId: "75e955ca-0ad0-4c0d-b8bf-cb265eea466e",
      level: "warn",
      operation: "itinerary.generate.v1",
      outcome: "retry_scheduled",
      releaseSha: "abc123",
      service: "roavia-worker",
      subjectId: "trip-123",
      timestamp: "2026-07-28T00:00:00.000Z",
      type: "itinerary.generate.v1",
    });
    expect(lines[0]).not.toContain("payload");
    expect(observability.metrics.sum("roavia_job_events_total", { event: "retry_scheduled" })).toBe(
      1,
    );
  });

  test("prunes lifecycle evidence on schedule and logs aggregate counts only", async () => {
    const lines: string[] = [];
    const observability = new RuntimeObservability({
      clock: () => new Date("2026-08-02T00:00:00.000Z"),
      environment: "test",
      releaseSha: "abc123",
      service: "roavia-worker",
      sink: (line) => lines.push(line),
    });
    const pruneExpired = vi.fn<
      () => Promise<{ audits: number; exports: number; receipts: number; tombstones: number }>
    >(async () => ({
      audits: 1,
      exports: 2,
      receipts: 3,
      tombstones: 4,
    }));

    const stop = startAccountRetentionMonitor({ pruneExpired }, observability, 60_000);
    await vi.waitFor(() => expect(pruneExpired).toHaveBeenCalledTimes(1));
    stop();

    expect(JSON.parse(lines[0]!)).toMatchObject({
      actionCount: 10,
      event: "account_retention_pruned",
      operation: "account.retention",
      outcome: "success",
    });
    expect(lines[0]).not.toContain("accountId");
  });
});
