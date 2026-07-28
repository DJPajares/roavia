import { describe, expect, test } from "vitest";

import { formatJobTelemetry } from "../src/telemetry.js";

describe("worker telemetry", () => {
  test("contains correlation fields without job payload data", () => {
    const output = formatJobTelemetry(
      {
        attempt: 2,
        correlationId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
        event: "retry_scheduled",
        jobId: "75e955ca-0ad0-4c0d-b8bf-cb265eea466e",
        subjectId: "trip-123",
        timestamp: new Date("2026-07-28T00:00:00.000Z"),
        type: "itinerary.generate.v1",
      },
      "abc123",
    );

    expect(JSON.parse(output)).toEqual({
      attempt: 2,
      correlationId: "46edbf9d-5c17-4f45-9287-69a39450a9dc",
      event: "retry_scheduled",
      jobId: "75e955ca-0ad0-4c0d-b8bf-cb265eea466e",
      releaseSha: "abc123",
      service: "roavia-worker",
      subjectId: "trip-123",
      timestamp: "2026-07-28T00:00:00.000Z",
      type: "itinerary.generate.v1",
    });
    expect(output).not.toContain("payload");
  });
});
