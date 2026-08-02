import { describe, expect, test, vi } from "vitest";

import type {
  LiveConditionBatch,
  LiveConditionEvent,
  LiveConditionTarget,
} from "@roavia/travel-data";

import {
  LIVE_CONDITION_RECONCILIATION_JOB_TYPE,
  MemoryJobRuntime,
  createLiveConditionReconciliationJob,
  createLiveConditionReconciliationService,
  enqueueLiveConditionReconciliation,
  enqueueUpcomingLiveConditionReconciliations,
  type LiveConditionImpactStore,
  type LiveConditionReconciliationService,
  type LiveConditionSource,
  type LiveConditionTargetStore,
} from "../src/index.js";

const now = new Date("2026-08-02T08:00:00.000Z");
const correlationId = "47000000-0000-4000-8000-000000000010";
const tripId = "47000000-0000-4000-8000-000000000011";
const itemId = "47000000-0000-4000-8000-000000000012";
const placeId = "47000000-0000-4000-8000-000000000013";

const target: LiveConditionTarget = {
  coordinates: { latitude: 1.3521, longitude: 103.8198 },
  itineraryItemId: itemId,
  localDate: "2026-08-05",
  placeId,
  timezone: "Asia/Singapore",
  tripId,
};

function weatherEvent(overrides: Partial<LiveConditionEvent> = {}): LiveConditionEvent {
  return {
    confidence: 0.9,
    endDate: "2026-08-05",
    eventId: "weather:thunderstorm:2026-08-05",
    kind: "weather",
    placeId,
    provider: "weather-fixture",
    severity: "high",
    source: {
      offlineUseAllowed: true,
      provider: "weather-fixture",
      redistributionAllowed: true,
      retrievedAt: "2026-08-02T07:55:00.000Z",
      sourceUrl: "https://weather.example.test/forecast",
      title: "Fixture weather source",
    },
    startDate: "2026-08-05",
    summary: "A stronger thunderstorm forecast overlaps this item.",
    updatedAt: "2026-08-02T07:50:00.000Z",
    ...overrides,
  };
}

function freshBatch(events: readonly LiveConditionEvent[]): LiveConditionBatch {
  return {
    checkedAt: now.toISOString(),
    events,
    kind: "weather",
    placeId,
    provider: "weather-fixture",
    state: "fresh",
  };
}

function targetStore(tripIds: readonly string[] = [tripId]): LiveConditionTargetStore {
  return {
    getUpcomingTargets: vi.fn<LiveConditionTargetStore["getUpcomingTargets"]>(
      async ({ tripId: requestedTripId }) => (requestedTripId === tripId ? [target] : []),
    ),
    listUpcomingTripIds: vi.fn<LiveConditionTargetStore["listUpcomingTripIds"]>(
      async () => tripIds,
    ),
  };
}

function impactStore() {
  const apply = vi.fn<LiveConditionImpactStore["apply"]>().mockResolvedValue({
    created: 1,
    resolved: 0,
    unchanged: 0,
    updated: 0,
  });
  return { apply };
}

describe("live-condition reconciliation jobs", () => {
  test("targets only discovered upcoming trips and deduplicates the refresh window", async () => {
    const targets = targetStore();
    const impacts = impactStore();
    const source = {
      refresh: vi.fn<LiveConditionSource["refresh"]>(async () => [freshBatch([weatherEvent()])]),
    };
    const service = createLiveConditionReconciliationService({
      clock: () => now,
      impacts,
      source,
      targets,
    });
    const runtime = new MemoryJobRuntime();
    runtime.register(createLiveConditionReconciliationJob(service));

    const first = await enqueueUpcomingLiveConditionReconciliations(runtime, targets, {
      asOf: now,
      correlationId,
      refreshKey: "2026-08-02T08",
    });
    const duplicate = await enqueueUpcomingLiveConditionReconciliations(runtime, targets, {
      asOf: now,
      correlationId,
      refreshKey: "2026-08-02T08",
    });
    expect(duplicate[0]?.envelope.jobId).toBe(first[0]?.envelope.jobId);

    await runtime.runUntilIdle();

    expect(targets.listUpcomingTripIds).toHaveBeenCalledWith({
      asOfDate: "2026-08-02",
      horizonEndDate: "2026-08-16",
    });
    expect(source.refresh).toHaveBeenCalledTimes(1);
    expect(impacts.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        impacts: [expect.objectContaining({ itineraryItemId: itemId, severity: "high" })],
        tripId,
      }),
    );
    expect(first[0]).toMatchObject({
      result: { created: 1, impacts: 1, status: "reconciled" },
      status: "succeeded",
    });
  });

  test("degrades quietly during an outage and recovers on a later refresh", async () => {
    const targets = targetStore();
    const impacts = impactStore();
    const refresh = vi
      .fn<LiveConditionSource["refresh"]>()
      .mockRejectedValueOnce(new Error("provider secret must not escape"))
      .mockResolvedValueOnce([freshBatch([weatherEvent()])]);
    const service = createLiveConditionReconciliationService({
      clock: () => now,
      impacts,
      source: { refresh },
      targets,
    });
    const runtime = new MemoryJobRuntime();
    runtime.register(createLiveConditionReconciliationJob(service));

    const outage = await enqueueLiveConditionReconciliation(runtime, {
      correlationId,
      refreshKey: "outage-window",
      tripId,
    });
    await runtime.runUntilIdle();
    expect(outage).toMatchObject({
      result: { degraded: true, status: "provider_unavailable" },
      status: "succeeded",
    });
    expect(JSON.stringify(outage.result)).not.toContain("provider secret");
    expect(impacts.apply).not.toHaveBeenCalled();

    const recovered = await enqueueLiveConditionReconciliation(runtime, {
      correlationId,
      refreshKey: "recovery-window",
      tripId,
    });
    await runtime.runUntilIdle();
    expect(recovered).toMatchObject({
      result: { degraded: false, status: "reconciled" },
      status: "succeeded",
    });
    expect(impacts.apply).toHaveBeenCalledTimes(1);
  });

  test("does not resolve active impacts from stale provider data", async () => {
    const targets = targetStore();
    const impacts = impactStore();
    const staleBatch = { ...freshBatch([weatherEvent()]), state: "stale" as const };
    const service = createLiveConditionReconciliationService({
      clock: () => now,
      impacts,
      source: { refresh: async () => [staleBatch] },
      targets,
    });

    const summary = await service.reconcile({
      requestId: correlationId,
      signal: new AbortController().signal,
      tripId,
    });

    expect(summary).toMatchObject({ degraded: true, impacts: 0, status: "reconciled" });
    expect(impacts.apply).not.toHaveBeenCalled();
  });

  test("preserves cancellation when provider work aborts", async () => {
    const targets = targetStore();
    const impacts = impactStore();
    const controller = new AbortController();
    const service = createLiveConditionReconciliationService({
      clock: () => now,
      impacts,
      source: {
        refresh: async () => {
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        },
      },
      targets,
    });

    await expect(
      service.reconcile({ requestId: correlationId, signal: controller.signal, tripId }),
    ).rejects.toMatchObject({ code: "cancelled", kind: "cancelled" });
    expect(impacts.apply).not.toHaveBeenCalled();
  });

  test("dead-letters a mismatched trip before provider access", async () => {
    const reconcile = vi.fn<LiveConditionReconciliationService["reconcile"]>();
    const runtime = new MemoryJobRuntime();
    runtime.register(createLiveConditionReconciliationJob({ reconcile }));
    const record = await runtime.enqueue({
      correlationId,
      idempotencyKey: "live:mismatched-subject",
      payload: { refreshKey: "mismatch", tripId },
      requestedBy: { id: "live-test", kind: "system" },
      subjectId: "47000000-0000-4000-8000-000000000099",
      type: LIVE_CONDITION_RECONCILIATION_JOB_TYPE,
    });

    await runtime.runNext();

    expect(record).toMatchObject({ errorCode: "invalid_subject", status: "dead_lettered" });
    expect(reconcile).not.toHaveBeenCalled();
  });
});
