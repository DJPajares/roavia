import { createHash } from "node:crypto";

import {
  offlinePackageManifestSchema,
  type OfflinePackageManifest,
  type OfflinePackagePlace,
  type OfflinePackageSource,
  type TripDetail,
} from "@roavia/contracts";

import { canonicalJson, serializeOfflineManifest } from "./index.js";

type LicensedSource = OfflinePackageSource & {
  offlineUseAllowed: boolean;
  redistributionAllowed: boolean;
};

export interface OfflineGuidanceInput {
  contentType: string;
  data: Record<string, unknown>;
  freshness: "fresh" | "stale";
  placeId: string;
  refreshedAt: string;
  sources: LicensedSource[];
}

export interface BuildOfflinePackageInput {
  generatedAt: Date;
  guidance: OfflineGuidanceInput[];
  packageVersion: number;
  places: OfflinePackagePlace[];
  trip: TripDetail;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function withExactSize(manifest: OfflinePackageManifest): OfflinePackageManifest {
  let candidate = manifest;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const sizeBytes = new TextEncoder().encode(serializeOfflineManifest(candidate)).byteLength;
    if (sizeBytes === candidate.sizeBytes) return candidate;
    candidate = { ...candidate, sizeBytes };
  }
  return candidate;
}

export function buildOfflinePackage(input: BuildOfflinePackageInput): OfflinePackageManifest {
  const placeById = new Map(input.places.map((place) => [place.id, place]));
  const licensedGuidance: OfflinePackageManifest["guidance"] = [];
  const excludedContent: OfflinePackageManifest["licensing"]["excludedContent"] = [];

  for (const record of input.guidance.toSorted(
    (left, right) =>
      left.placeId.localeCompare(right.placeId) ||
      left.contentType.localeCompare(right.contentType),
  )) {
    if (
      record.sources.length === 0 ||
      record.sources.some((source) => !source.offlineUseAllowed || !source.redistributionAllowed)
    ) {
      excludedContent.push({
        contentType: record.contentType,
        placeId: record.placeId,
        reason: "offline_redistribution_not_permitted",
      });
      continue;
    }
    licensedGuidance.push({
      contentType: record.contentType,
      data: record.data,
      freshness: record.freshness,
      placeId: record.placeId,
      refreshedAt: record.refreshedAt,
      sources: record.sources
        .toSorted(
          (left, right) =>
            left.url.localeCompare(right.url) || left.retrievedAt.localeCompare(right.retrievedAt),
        )
        .map(
          ({ offlineUseAllowed: _offline, redistributionAllowed: _redistribution, ...source }) =>
            source,
        ),
    });
  }

  const trip = {
    id: input.trip.id,
    revision: input.trip.revision,
    title: input.trip.title,
    startDate: input.trip.startDate,
    endDate: input.trip.endDate,
    destinations: input.trip.destinations
      .toSorted(
        (left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id),
      )
      .map((destination) => ({
        arrivalAt: destination.arrivalAt,
        departureAt: destination.departureAt,
        orderIndex: destination.orderIndex,
        place: placeById.get(destination.placeId)!,
      })),
    days: input.trip.days
      .toSorted(
        (left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id),
      )
      .map((day) => ({
        id: day.id,
        localDate: day.localDate,
        notes: day.notes,
        orderIndex: day.orderIndex,
        timezone: day.timezone,
        title: day.title,
        items: day.items
          .toSorted(
            (left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id),
          )
          .map((item) => {
            const snapshot = objectOrNull(item.sourceSnapshot);
            const basePlace = item.placeId ? placeById.get(item.placeId) : undefined;
            const address = typeof snapshot?.address === "string" ? snapshot.address : null;
            return {
              booking: {
                availability: "unavailable_offline" as const,
                snapshot: objectOrNull(item.booking),
              },
              durationMinutes: item.durationMinutes,
              endTime: item.endTime,
              estimatedCost: item.estimatedCost,
              id: item.id,
              itemType: item.itemType,
              notes: item.notes,
              orderIndex: item.orderIndex,
              place: basePlace ? { ...basePlace, address: address ?? basePlace.address } : null,
              startTime: item.startTime,
              transport: objectOrNull(item.transport),
            };
          }),
      })),
  };
  if (trip.destinations.some((destination) => !destination.place)) {
    throw new Error(
      "Offline packages require every trip destination to resolve to an active place.",
    );
  }

  const packageContent = {
    schemaVersion: 1 as const,
    trip,
    guidance: licensedGuidance,
    licensing: { excludedContent },
    liveData: {
      assistantResponses: "unavailable_offline" as const,
      bookingAvailability: "unavailable_offline" as const,
      closures: "unavailable_offline" as const,
      prices: "unavailable_offline" as const,
      weather: "unavailable_offline" as const,
    },
  };
  const manifest = offlinePackageManifestSchema.parse({
    ...packageContent,
    packageVersion: input.packageVersion,
    contentHash: contentHash(packageContent),
    generatedAt: input.generatedAt.toISOString(),
    sizeBytes: 0,
  });
  return offlinePackageManifestSchema.parse(withExactSize(manifest));
}
