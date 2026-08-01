import { describe, expect, test, vi } from "vitest";

import {
  MemoryJobRuntime,
  SEASONAL_INSIGHT_REFRESH_JOB_TYPE,
  createSeasonalInsightRefreshJob,
  enqueueSeasonalInsightRefresh,
  type SeasonalInsightRefreshService,
} from "../src/index.js";

const placeId = "45000000-0000-4000-8000-000000000001";
const correlationId = "45000000-0000-4000-8000-000000000002";

function refreshInput() {
  return {
    correlationId,
    periodKeys: ["month:2027-03", "month:2027-04"],
    placeId,
    priorities: { budget: 1, crowds: 2, festivals: 3, weather: 4 },
    refreshVersion: "launch-2027-v1",
  };
}

describe("seasonal insight refresh job", () => {
  test("executes duplicate delivery once and reports preserved reviewed overrides", async () => {
    const refresh = vi.fn<SeasonalInsightRefreshService["refresh"]>().mockResolvedValue({
      created: 1,
      preservedReviewedOverrides: 1,
      unchanged: 0,
      updated: 1,
    });
    const runtime = new MemoryJobRuntime();
    runtime.register(createSeasonalInsightRefreshJob({ refresh }));

    const first = await enqueueSeasonalInsightRefresh(runtime, refreshInput());
    const duplicate = await enqueueSeasonalInsightRefresh(runtime, refreshInput());
    expect(duplicate.envelope.jobId).toBe(first.envelope.jobId);

    await runtime.runUntilIdle();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({
      periodKeys: ["month:2027-03", "month:2027-04"],
      placeId,
      priorities: { budget: 1, crowds: 2, festivals: 3, weather: 4 },
      refreshVersion: "launch-2027-v1",
      requestId: correlationId,
      signal: expect.any(AbortSignal),
    });
    expect(first).toMatchObject({
      result: {
        created: 1,
        placeId,
        preservedReviewedOverrides: 1,
        refreshVersion: "launch-2027-v1",
        unchanged: 0,
        updated: 1,
      },
      status: "succeeded",
    });
  });

  test("dead-letters a mismatched place before refreshing", async () => {
    const refresh = vi.fn<SeasonalInsightRefreshService["refresh"]>();
    const runtime = new MemoryJobRuntime();
    runtime.register(createSeasonalInsightRefreshJob({ refresh }));
    const record = await runtime.enqueue({
      correlationId,
      idempotencyKey: "seasonal:mismatched-subject",
      payload: {
        periodKeys: ["month:2027-04"],
        placeId,
        refreshVersion: "launch-2027-v2",
      },
      requestedBy: { id: "seasonal-test", kind: "system" },
      subjectId: "45000000-0000-4000-8000-000000000099",
      type: SEASONAL_INSIGHT_REFRESH_JOB_TYPE,
    });

    await runtime.runNext();

    expect(record).toMatchObject({ errorCode: "invalid_subject", status: "dead_lettered" });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("does not collapse materially different requests sharing a refresh version", async () => {
    const runtime = new MemoryJobRuntime();
    runtime.register(
      createSeasonalInsightRefreshJob({
        refresh: async () => ({
          created: 0,
          preservedReviewedOverrides: 0,
          unchanged: 2,
          updated: 0,
        }),
      }),
    );

    const weatherFirst = await enqueueSeasonalInsightRefresh(runtime, refreshInput());
    const budgetFirst = await enqueueSeasonalInsightRefresh(runtime, {
      ...refreshInput(),
      priorities: { budget: 5, weather: 0.5 },
    });

    expect(budgetFirst.envelope.jobId).not.toBe(weatherFirst.envelope.jobId);
  });

  test("rejects duplicate or malformed periods before enqueue", async () => {
    const runtime = new MemoryJobRuntime();
    runtime.register(
      createSeasonalInsightRefreshJob({
        refresh: async () => ({
          created: 0,
          preservedReviewedOverrides: 0,
          unchanged: 0,
          updated: 0,
        }),
      }),
    );

    await expect(
      enqueueSeasonalInsightRefresh(runtime, {
        ...refreshInput(),
        periodKeys: ["month:2027-13", "month:2027-13"],
      }),
    ).rejects.toThrow(/periodKeys|Invalid/);
  });
});
