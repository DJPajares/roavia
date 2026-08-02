import type { ProviderSource } from "./contracts.js";

export const liveConditionKinds = ["closure", "weather"] as const;
export const liveImpactSeverities = ["low", "moderate", "high", "critical"] as const;

export type LiveConditionKind = (typeof liveConditionKinds)[number];
export type LiveImpactSeverity = (typeof liveImpactSeverities)[number];

export interface LiveConditionTarget {
  coordinates: { latitude: number; longitude: number };
  itineraryItemId: string;
  localDate: string;
  placeId: string;
  timezone: string;
  tripId: string;
}

export interface LiveConditionEvent {
  confidence: number;
  endDate: string;
  eventId: string;
  kind: LiveConditionKind;
  placeId: string;
  provider: string;
  severity: LiveImpactSeverity;
  source: ProviderSource;
  staleAt?: string;
  startDate: string;
  summary: string;
  updatedAt: string;
}

export interface LiveConditionBatch {
  checkedAt: string;
  events: readonly LiveConditionEvent[];
  kind: LiveConditionKind;
  placeId: string;
  provider: string;
  state: "fresh" | "stale" | "unavailable";
}

export interface LiveConditionImpact {
  confidence: number;
  endDate: string;
  impactKey: string;
  itineraryItemId: string;
  kind: LiveConditionKind;
  placeId: string;
  provider: string;
  providerEventId: string;
  severity: LiveImpactSeverity;
  sourceRetrievedAt: string;
  sourceTitle: string | null;
  sourceUpdatedAt: string;
  sourceUrl: string;
  startDate: string;
  summary: string;
  tripId: string;
}

export interface LiveConditionObservation {
  impactKeys: readonly string[];
  kind: LiveConditionKind;
  placeId: string;
  provider: string;
}

export interface LiveConditionEvaluation {
  ignored: {
    duplicates: number;
    lowConfidence: number;
    lowImpact: number;
    stale: number;
    unmatched: number;
    unavailableBatches: number;
  };
  impacts: readonly LiveConditionImpact[];
  observations: readonly LiveConditionObservation[];
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const severityRank: Record<LiveImpactSeverity, number> = {
  critical: 3,
  high: 2,
  low: 0,
  moderate: 1,
};

function assertDate(value: string, name: string) {
  if (!isoDatePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must be an ISO date.`);
  }
}

function assertTimestamp(value: string, name: string) {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp.`);
}

function assertTarget(target: LiveConditionTarget) {
  assertDate(target.localDate, "Live-condition target date");
  if (!target.itineraryItemId || !target.placeId || !target.tripId || !target.timezone) {
    throw new Error("Live-condition targets require item, place, trip, and timezone identifiers.");
  }
  if (
    !Number.isFinite(target.coordinates.latitude) ||
    target.coordinates.latitude < -90 ||
    target.coordinates.latitude > 90 ||
    !Number.isFinite(target.coordinates.longitude) ||
    target.coordinates.longitude < -180 ||
    target.coordinates.longitude > 180
  ) {
    throw new Error("Live-condition target coordinates are invalid.");
  }
}

function assertEvent(event: LiveConditionEvent, batch: LiveConditionBatch) {
  assertDate(event.startDate, "Live-condition event start date");
  assertDate(event.endDate, "Live-condition event end date");
  assertTimestamp(event.updatedAt, "Live-condition event update time");
  assertTimestamp(event.source.retrievedAt, "Live-condition source retrieval time");
  if (event.staleAt) assertTimestamp(event.staleAt, "Live-condition stale time");
  if (event.endDate < event.startDate) throw new Error("Live-condition event dates are reversed.");
  if (
    event.kind !== batch.kind ||
    event.placeId !== batch.placeId ||
    event.provider !== batch.provider
  ) {
    throw new Error("Live-condition events must match their provider batch.");
  }
  if (
    !event.eventId ||
    !event.placeId ||
    !event.provider ||
    !event.summary.trim() ||
    !event.source.sourceUrl
  ) {
    throw new Error("Live-condition events require stable identity, source, and summary fields.");
  }
  if (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1) {
    throw new Error("Live-condition confidence must be between zero and one.");
  }
}

function overlaps(target: LiveConditionTarget, event: LiveConditionEvent) {
  return (
    target.placeId === event.placeId &&
    target.localDate >= event.startDate &&
    target.localDate <= event.endDate
  );
}

export function liveConditionImpactKey(event: LiveConditionEvent, target: LiveConditionTarget) {
  return `${event.kind}:${event.provider}:${event.eventId}:${target.itineraryItemId}`;
}

/**
 * Produces advisory-only impacts from fresh, material, sufficiently confident
 * provider events. It never mutates an itinerary and never promotes stale data.
 */
export function evaluateLiveConditions(
  targets: readonly LiveConditionTarget[],
  batches: readonly LiveConditionBatch[],
  options: {
    minimumConfidence?: number;
    minimumSeverity?: LiveImpactSeverity;
    now?: Date;
  } = {},
): LiveConditionEvaluation {
  for (const target of targets) assertTarget(target);
  const minimumConfidence = options.minimumConfidence ?? 0.65;
  const minimumSeverity = options.minimumSeverity ?? "moderate";
  const now = options.now ?? new Date();
  if (minimumConfidence < 0 || minimumConfidence > 1) {
    throw new Error("Live-condition minimum confidence must be between zero and one.");
  }

  const impacts = new Map<string, LiveConditionImpact>();
  const observations: LiveConditionObservation[] = [];
  const ignored = {
    duplicates: 0,
    lowConfidence: 0,
    lowImpact: 0,
    stale: 0,
    unmatched: 0,
    unavailableBatches: 0,
  };

  for (const batch of batches) {
    assertTimestamp(batch.checkedAt, "Live-condition batch check time");
    for (const event of batch.events) assertEvent(event, batch);
    if (batch.state === "unavailable") {
      ignored.unavailableBatches += 1;
      continue;
    }
    if (batch.state === "stale") {
      ignored.stale += batch.events.length;
      continue;
    }

    const observedKeys: string[] = [];
    for (const event of batch.events) {
      if (event.staleAt && Date.parse(event.staleAt) <= now.getTime()) {
        ignored.stale += 1;
        continue;
      }
      const matchingTargets = targets.filter((target) => overlaps(target, event));
      if (matchingTargets.length === 0) {
        ignored.unmatched += 1;
        continue;
      }
      if (event.confidence < minimumConfidence) {
        observedKeys.push(
          ...matchingTargets.map((target) => liveConditionImpactKey(event, target)),
        );
        ignored.lowConfidence += matchingTargets.length;
        continue;
      }
      if (severityRank[event.severity] < severityRank[minimumSeverity]) {
        ignored.lowImpact += matchingTargets.length;
        continue;
      }
      for (const target of matchingTargets) {
        const impactKey = liveConditionImpactKey(event, target);
        observedKeys.push(impactKey);
        if (impacts.has(impactKey)) ignored.duplicates += 1;
        impacts.set(impactKey, {
          confidence: event.confidence,
          endDate: event.endDate,
          impactKey,
          itineraryItemId: target.itineraryItemId,
          kind: event.kind,
          placeId: target.placeId,
          provider: event.provider,
          providerEventId: event.eventId,
          severity: event.severity,
          sourceRetrievedAt: event.source.retrievedAt,
          sourceTitle: event.source.title ?? null,
          sourceUpdatedAt: event.updatedAt,
          sourceUrl: event.source.sourceUrl,
          startDate: event.startDate,
          summary: event.summary.trim(),
          tripId: target.tripId,
        });
      }
    }
    observations.push({
      impactKeys: [...new Set(observedKeys)].toSorted(),
      kind: batch.kind,
      placeId: batch.placeId,
      provider: batch.provider,
    });
  }

  return {
    ignored,
    impacts: [...impacts.values()].toSorted((left, right) =>
      left.impactKey.localeCompare(right.impactKey),
    ),
    observations,
  };
}
