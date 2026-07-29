import type { OfflinePackagePlace, TripDetail } from "@roavia/contracts";
import { describe, expect, test } from "vitest";

import { serializeOfflineManifest } from "../src/index.js";
import { buildOfflinePackage } from "../src/server.js";

const tripId = "11111111-1111-4111-8111-111111111111";
const placeId = "22222222-2222-4222-8222-222222222222";
const dayId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";

const trip: TripDetail = {
  budget: { amountMinor: 200_000, currency: "JPY", style: "midrange" },
  createdAt: "2026-07-29T00:00:00.000Z",
  dateFlexibility: { daysAfter: 0, daysBefore: 0 },
  days: [
    {
      id: dayId,
      items: [
        {
          booking: { required: true },
          confidence: 0.9,
          durationMinutes: 60,
          endTime: "10:00",
          estimatedCost: { amountMinor: 2_500, currency: "JPY" },
          id: itemId,
          itineraryDayId: dayId,
          itemType: "food",
          notes: "Use the east entrance.",
          orderIndex: 0,
          placeId,
          sourceSnapshot: { address: "1 Market Street" },
          startTime: "09:00",
          transport: { mode: "walk" },
        },
      ],
      localDate: "2026-10-02",
      notes: "Keep the emergency card in the day bag.",
      orderIndex: 0,
      timezone: "Asia/Tokyo",
      title: "Arrival",
      tripId,
    },
  ],
  destinations: [
    {
      arrivalAt: "2026-10-01T00:00:00.000Z",
      departureAt: "2026-10-06T00:00:00.000Z",
      id: "55555555-5555-4555-8555-555555555555",
      orderIndex: 0,
      placeId,
      tripId,
    },
  ],
  endDate: "2026-10-06",
  generation: null,
  generationState: "ready",
  id: tripId,
  originPlaceId: null,
  planningPreferences: null,
  revision: 3,
  slug: "tokyo-trip",
  startDate: "2026-10-01",
  status: "active",
  title: "Tokyo trip",
  travelerSummary: { adults: 2, children: 0, infants: 0 },
  updatedAt: "2026-07-29T00:00:00.000Z",
  visibility: "private",
};

const places: OfflinePackagePlace[] = [
  {
    address: null,
    coordinates: { latitude: 35.6762, longitude: 139.6503 },
    id: placeId,
    name: "Tokyo",
    timezone: "Asia/Tokyo",
    type: "city",
  },
];

const baseInput = {
  generatedAt: new Date("2026-07-29T12:00:00.000Z"),
  packageVersion: 1,
  places,
  trip,
  guidance: [
    {
      contentType: "emergency",
      data: { emergencyNumber: "110" },
      freshness: "fresh" as const,
      placeId,
      refreshedAt: "2026-07-28T00:00:00.000Z",
      sources: [
        {
          attribution: "Tokyo Metropolitan Government",
          license: "open-government-data",
          licenseUrl: "https://example.com/license",
          offlineUseAllowed: true,
          redistributionAllowed: true,
          retrievedAt: "2026-07-28T00:00:00.000Z",
          title: "Emergency information",
          trustTier: "tier_1" as const,
          url: "https://example.com/emergency",
        },
      ],
    },
    {
      contentType: "media",
      data: { image: "licensed-provider-image" },
      freshness: "fresh" as const,
      placeId,
      refreshedAt: "2026-07-28T00:00:00.000Z",
      sources: [
        {
          attribution: "Restricted provider",
          license: "display-only",
          licenseUrl: null,
          offlineUseAllowed: false,
          redistributionAllowed: false,
          retrievedAt: "2026-07-28T00:00:00.000Z",
          title: "Restricted media",
          trustTier: "tier_3" as const,
          url: "https://example.com/media",
        },
      ],
    },
  ],
};

describe("offline package manifests", () => {
  test("serializes deterministically with exact size, licensed guidance, notes, and offline boundaries", () => {
    const first = buildOfflinePackage(baseInput);
    const second = buildOfflinePackage(baseInput);

    expect(serializeOfflineManifest(first)).toBe(serializeOfflineManifest(second));
    expect(first.sizeBytes).toBe(new TextEncoder().encode(serializeOfflineManifest(first)).length);
    expect(first.guidance).toHaveLength(1);
    expect(first.guidance[0]).toMatchObject({ contentType: "emergency" });
    expect(first.licensing.excludedContent).toEqual([
      { contentType: "media", placeId, reason: "offline_redistribution_not_permitted" },
    ]);
    expect(first.trip.days[0]?.items[0]?.place).toMatchObject({
      address: "1 Market Street",
      coordinates: places[0]?.coordinates,
    });
    expect(first.trip.days[0]?.notes).toContain("emergency card");
    expect(new Set(Object.values(first.liveData))).toEqual(new Set(["unavailable_offline"]));
  });

  test("keeps the content hash stable across package versions and generation times", () => {
    const first = buildOfflinePackage(baseInput);
    const regenerated = buildOfflinePackage({
      ...baseInput,
      generatedAt: new Date("2026-07-30T12:00:00.000Z"),
      packageVersion: 2,
    });

    expect(regenerated.contentHash).toBe(first.contentHash);
    expect(regenerated.packageVersion).toBe(2);
    expect(regenerated.generatedAt).not.toBe(first.generatedAt);
  });
});
