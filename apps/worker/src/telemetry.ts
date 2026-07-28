import type { JobTelemetry } from "@roavia/jobs";

export function formatJobTelemetry(event: JobTelemetry, releaseSha: string) {
  return JSON.stringify({
    attempt: event.attempt,
    correlationId: event.correlationId,
    durationMs: event.durationMs,
    event: event.event,
    jobId: event.jobId,
    queueDelayMs: event.queueDelayMs,
    releaseSha,
    service: "roavia-worker",
    subjectId: event.subjectId,
    timestamp: event.timestamp.toISOString(),
    type: event.type,
  });
}
