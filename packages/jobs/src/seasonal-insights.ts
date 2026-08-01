import { createHash } from "node:crypto";

import { z } from "zod";

import { cancelledJob, permanentJobFailure } from "./errors.js";
import { defaultJobPolicy, defineJob, type JobRecord } from "./contracts.js";
import type { JobRuntime } from "./port.js";

export const SEASONAL_INSIGHT_REFRESH_JOB_TYPE = "seasonal.insights-refresh.v1" as const;

const periodKeySchema = z
  .string()
  .regex(/^(month:\d{4}-(?:0[1-9]|1[0-2])|range:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2})$/);

export const seasonalInsightRefreshPayloadSchema = z
  .object({
    periodKeys: z.array(periodKeySchema).min(1).max(36),
    placeId: z.uuid(),
    priorities: z
      .object({
        budget: z.number().min(0).max(5).optional(),
        closures: z.number().min(0).max(5).optional(),
        crowds: z.number().min(0).max(5).optional(),
        festivals: z.number().min(0).max(5).optional(),
        weather: z.number().min(0).max(5).optional(),
      })
      .strict()
      .optional(),
    refreshVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
  })
  .strict()
  .superRefine((payload, context) => {
    if (new Set(payload.periodKeys).size !== payload.periodKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Seasonal refresh period keys must be unique.",
        path: ["periodKeys"],
      });
    }
  });

export type SeasonalInsightRefreshPayload = z.infer<typeof seasonalInsightRefreshPayloadSchema>;

export interface SeasonalInsightRefreshSummary {
  created: number;
  preservedReviewedOverrides: number;
  unchanged: number;
  updated: number;
}

export interface SeasonalInsightRefreshService {
  refresh(
    input: SeasonalInsightRefreshPayload & { requestId: string; signal: AbortSignal },
  ): Promise<SeasonalInsightRefreshSummary>;
}

export interface EnqueueSeasonalInsightRefreshInput extends SeasonalInsightRefreshPayload {
  correlationId: string;
  requestedById?: string;
}

export function seasonalInsightRefreshIdempotencyKey(input: SeasonalInsightRefreshPayload) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        periodKeys: input.periodKeys.toSorted(),
        priorities: Object.fromEntries(Object.entries(input.priorities ?? {}).toSorted()),
        refreshVersion: input.refreshVersion,
      }),
    )
    .digest("hex");
  return `seasonal:${input.placeId}:${digest}`;
}

export async function enqueueSeasonalInsightRefresh(
  runtime: JobRuntime,
  input: EnqueueSeasonalInsightRefreshInput,
): Promise<JobRecord> {
  const payload = seasonalInsightRefreshPayloadSchema.parse({
    periodKeys: input.periodKeys,
    placeId: input.placeId,
    priorities: input.priorities,
    refreshVersion: input.refreshVersion,
  });
  return runtime.enqueue({
    correlationId: input.correlationId,
    idempotencyKey: seasonalInsightRefreshIdempotencyKey(payload),
    payload,
    requestedBy: { id: input.requestedById ?? "seasonal-refresh", kind: "system" },
    subjectId: payload.placeId,
    type: SEASONAL_INSIGHT_REFRESH_JOB_TYPE,
  });
}

export function createSeasonalInsightRefreshJob(service: SeasonalInsightRefreshService) {
  return defineJob({
    handler: async (payload, envelope, context) => {
      if (payload.placeId !== envelope.subjectId) {
        throw permanentJobFailure(
          "invalid_subject",
          "The seasonal refresh payload does not match its job subject.",
        );
      }
      if (context.signal.aborted) throw cancelledJob();
      const summary = await service.refresh({
        ...payload,
        requestId: envelope.correlationId,
        signal: context.signal,
      });
      if (context.signal.aborted) throw cancelledJob();
      return { ...summary, placeId: payload.placeId, refreshVersion: payload.refreshVersion };
    },
    payloadSchema: seasonalInsightRefreshPayloadSchema,
    payloadVersion: 1,
    policy: {
      ...defaultJobPolicy,
      concurrency: 2,
      timeoutMs: 5 * 60 * 1_000,
    },
    type: SEASONAL_INSIGHT_REFRESH_JOB_TYPE,
  });
}
