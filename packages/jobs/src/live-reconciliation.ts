import { z } from "zod";

import {
  getUpcomingLiveConditionTargets,
  listUpcomingLiveConditionTripIds,
  reconcileLiveConditionImpacts,
  type Database,
} from "@roavia/db";
import {
  evaluateLiveConditions,
  type LiveConditionBatch,
  type LiveConditionImpact,
  type LiveConditionObservation,
  type LiveConditionTarget,
} from "@roavia/travel-data";

import { cancelledJob, permanentJobFailure } from "./errors.js";
import { defaultJobPolicy, defineJob, type JobRecord } from "./contracts.js";
import type { JobRuntime } from "./port.js";

export const LIVE_CONDITION_RECONCILIATION_JOB_TYPE = "live.conditions-reconcile.v1" as const;

export const liveConditionReconciliationPayloadSchema = z
  .object({
    refreshKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
    tripId: z.uuid(),
  })
  .strict();

export type LiveConditionReconciliationPayload = z.infer<
  typeof liveConditionReconciliationPayloadSchema
>;

export interface LiveConditionTargetStore {
  getUpcomingTargets(input: {
    asOfDate: string;
    horizonEndDate: string;
    tripId: string;
  }): Promise<readonly LiveConditionTarget[]>;
  listUpcomingTripIds(input: {
    asOfDate: string;
    horizonEndDate: string;
  }): Promise<readonly string[]>;
}

export interface LiveConditionSource {
  refresh(input: {
    requestId: string;
    signal: AbortSignal;
    targets: readonly LiveConditionTarget[];
  }): Promise<readonly LiveConditionBatch[]>;
}

export interface LiveConditionImpactStore {
  apply(input: {
    checkedAt: Date;
    impacts: readonly LiveConditionImpact[];
    observations: readonly LiveConditionObservation[];
    tripId: string;
  }): Promise<{ created: number; resolved: number; unchanged: number; updated: number }>;
}

export function createPostgresLiveConditionStores(db: Database): {
  impacts: LiveConditionImpactStore;
  targets: LiveConditionTargetStore;
} {
  return {
    impacts: {
      apply: (input) => reconcileLiveConditionImpacts(db, input),
    },
    targets: {
      getUpcomingTargets: (input) => getUpcomingLiveConditionTargets(db, input),
      listUpcomingTripIds: (input) => listUpcomingLiveConditionTripIds(db, input),
    },
  };
}

export interface LiveConditionReconciliationSummary {
  created: number;
  degraded: boolean;
  ignored: number;
  impacts: number;
  resolved: number;
  status: "provider_unavailable" | "reconciled" | "skipped";
  unchanged: number;
  updated: number;
}

export interface LiveConditionReconciliationService {
  reconcile(input: {
    requestId: string;
    signal: AbortSignal;
    tripId: string;
  }): Promise<LiveConditionReconciliationSummary>;
}

const isoDayMilliseconds = 86_400_000;

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function windowFor(now: Date, horizonDays: number) {
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 15) {
    throw new Error("Live-condition horizon must be between one and fifteen days.");
  }
  return {
    asOfDate: isoDate(now),
    horizonEndDate: isoDate(new Date(now.getTime() + horizonDays * isoDayMilliseconds)),
  };
}

function ignoredCount(ignored: ReturnType<typeof evaluateLiveConditions>["ignored"]) {
  return Object.values(ignored).reduce((total, count) => total + count, 0);
}

export function createLiveConditionReconciliationService(options: {
  clock?: () => Date;
  horizonDays?: number;
  impacts: LiveConditionImpactStore;
  source: LiveConditionSource;
  targets: LiveConditionTargetStore;
}): LiveConditionReconciliationService {
  const horizonDays = options.horizonDays ?? 14;
  windowFor(new Date(0), horizonDays);
  return {
    async reconcile(input) {
      const now = options.clock?.() ?? new Date();
      const targets = await options.targets.getUpcomingTargets({
        ...windowFor(now, horizonDays),
        tripId: input.tripId,
      });
      if (targets.length === 0) {
        return {
          created: 0,
          degraded: false,
          ignored: 0,
          impacts: 0,
          resolved: 0,
          status: "skipped",
          unchanged: 0,
          updated: 0,
        };
      }
      if (input.signal.aborted) throw cancelledJob();

      let batches: readonly LiveConditionBatch[];
      try {
        batches = await options.source.refresh({
          requestId: input.requestId,
          signal: input.signal,
          targets,
        });
      } catch {
        if (input.signal.aborted) throw cancelledJob();
        return {
          created: 0,
          degraded: true,
          ignored: 0,
          impacts: 0,
          resolved: 0,
          status: "provider_unavailable",
          unchanged: 0,
          updated: 0,
        };
      }
      if (input.signal.aborted) throw cancelledJob();

      const evaluation = evaluateLiveConditions(targets, batches, { now });
      const providerUnavailable = batches.every((batch) => batch.state === "unavailable");
      const degraded = providerUnavailable || batches.some((batch) => batch.state !== "fresh");
      const persistence =
        evaluation.observations.length > 0
          ? await options.impacts.apply({
              checkedAt: now,
              impacts: evaluation.impacts,
              observations: evaluation.observations,
              tripId: input.tripId,
            })
          : { created: 0, resolved: 0, unchanged: 0, updated: 0 };
      return {
        ...persistence,
        degraded,
        ignored: ignoredCount(evaluation.ignored),
        impacts: evaluation.impacts.length,
        status: providerUnavailable ? "provider_unavailable" : "reconciled",
      };
    },
  };
}

export interface EnqueueLiveConditionReconciliationInput extends LiveConditionReconciliationPayload {
  correlationId: string;
  requestedById?: string;
}

export async function enqueueLiveConditionReconciliation(
  runtime: JobRuntime,
  input: EnqueueLiveConditionReconciliationInput,
): Promise<JobRecord> {
  const payload = liveConditionReconciliationPayloadSchema.parse({
    refreshKey: input.refreshKey,
    tripId: input.tripId,
  });
  return runtime.enqueue({
    correlationId: input.correlationId,
    idempotencyKey: `live:${payload.tripId}:${payload.refreshKey}`,
    payload,
    requestedBy: { id: input.requestedById ?? "live-reconciliation", kind: "system" },
    subjectId: payload.tripId,
    type: LIVE_CONDITION_RECONCILIATION_JOB_TYPE,
  });
}

export async function enqueueUpcomingLiveConditionReconciliations(
  runtime: JobRuntime,
  targets: LiveConditionTargetStore,
  input: {
    asOf?: Date;
    correlationId: string;
    horizonDays?: number;
    refreshKey: string;
    requestedById?: string;
  },
) {
  const window = windowFor(input.asOf ?? new Date(), input.horizonDays ?? 14);
  const tripIds = await targets.listUpcomingTripIds(window);
  return Promise.all(
    tripIds.map((tripId) =>
      enqueueLiveConditionReconciliation(runtime, {
        correlationId: input.correlationId,
        refreshKey: input.refreshKey,
        requestedById: input.requestedById,
        tripId,
      }),
    ),
  );
}

export function createLiveConditionReconciliationJob(service: LiveConditionReconciliationService) {
  return defineJob({
    handler: async (payload, envelope, context) => {
      if (payload.tripId !== envelope.subjectId) {
        throw permanentJobFailure(
          "invalid_subject",
          "The live-condition payload does not match its job subject.",
        );
      }
      if (context.signal.aborted) throw cancelledJob();
      const summary = await service.reconcile({
        requestId: envelope.correlationId,
        signal: context.signal,
        tripId: payload.tripId,
      });
      if (context.signal.aborted) throw cancelledJob();
      return { ...summary, refreshKey: payload.refreshKey, tripId: payload.tripId };
    },
    payloadSchema: liveConditionReconciliationPayloadSchema,
    payloadVersion: 1,
    policy: {
      ...defaultJobPolicy,
      concurrency: 4,
      timeoutMs: 2 * 60 * 1_000,
    },
    type: LIVE_CONDITION_RECONCILIATION_JOB_TYPE,
  });
}
