import { z } from "zod";

import { tripMoneySchema } from "./trips";

const jsonObjectSchema = z.record(z.string(), z.unknown());
const apiMetaSchema = z.object({ requestId: z.string().uuid() });

export const offlinePackageSourceSchema = z.object({
  attribution: z.string().nullable(),
  license: z.string().nullable(),
  licenseUrl: z.string().url().nullable(),
  retrievedAt: z.string().datetime({ offset: true }),
  title: z.string().nullable(),
  trustTier: z.enum(["tier_1", "tier_2", "tier_3", "tier_4"]),
  url: z.string().url(),
});

export const offlinePackagePlaceSchema = z.object({
  address: z.string().nullable(),
  coordinates: z
    .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
    .nullable(),
  id: z.string().uuid(),
  name: z.string().min(1),
  timezone: z.string().nullable(),
  type: z.enum(["country", "region", "city", "district", "poi", "transit_hub"]),
});

export const offlinePackageManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packageVersion: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime({ offset: true }),
  sizeBytes: z.number().int().nonnegative(),
  trip: z.object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    title: z.string().min(1),
    startDate: z.string().date(),
    endDate: z.string().date(),
    destinations: z.array(
      z.object({
        arrivalAt: z.string().datetime({ offset: true }).nullable(),
        departureAt: z.string().datetime({ offset: true }).nullable(),
        orderIndex: z.number().int().nonnegative(),
        place: offlinePackagePlaceSchema,
      }),
    ),
    days: z.array(
      z.object({
        id: z.string().uuid(),
        localDate: z.string().date(),
        notes: z.string().nullable(),
        orderIndex: z.number().int().nonnegative(),
        timezone: z.string().min(1),
        title: z.string().nullable(),
        items: z.array(
          z.object({
            booking: z.object({
              availability: z.literal("unavailable_offline"),
              snapshot: jsonObjectSchema.nullable(),
            }),
            durationMinutes: z.number().int().positive().nullable(),
            endTime: z.string().nullable(),
            estimatedCost: tripMoneySchema.nullable(),
            id: z.string().uuid(),
            itemType: z.string().min(1),
            notes: z.string().nullable(),
            orderIndex: z.number().int().nonnegative(),
            place: offlinePackagePlaceSchema.nullable(),
            startTime: z.string().nullable(),
            transport: jsonObjectSchema.nullable(),
          }),
        ),
      }),
    ),
  }),
  guidance: z.array(
    z.object({
      contentType: z.string().min(1),
      data: jsonObjectSchema,
      freshness: z.enum(["fresh", "stale"]),
      placeId: z.string().uuid(),
      refreshedAt: z.string().datetime({ offset: true }),
      sources: z.array(offlinePackageSourceSchema).min(1),
    }),
  ),
  licensing: z.object({
    excludedContent: z.array(
      z.object({
        contentType: z.string().min(1),
        placeId: z.string().uuid(),
        reason: z.literal("offline_redistribution_not_permitted"),
      }),
    ),
  }),
  liveData: z.object({
    assistantResponses: z.literal("unavailable_offline"),
    bookingAvailability: z.literal("unavailable_offline"),
    closures: z.literal("unavailable_offline"),
    prices: z.literal("unavailable_offline"),
    weather: z.literal("unavailable_offline"),
  }),
});

export const offlinePackageRecordSchema = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  version: z.number().int().positive(),
  generatedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  sizeBytes: z.number().int().nonnegative(),
  manifest: offlinePackageManifestSchema,
});

export const offlinePackageMutationResponseSchema = z.object({
  data: z.object({ package: offlinePackageRecordSchema, reused: z.boolean() }),
  meta: apiMetaSchema,
});

export const offlinePackageResponseSchema = z.object({
  data: z.object({ package: offlinePackageRecordSchema }),
  meta: apiMetaSchema,
});

export type OfflinePackageManifest = z.infer<typeof offlinePackageManifestSchema>;
export type OfflinePackageRecord = z.infer<typeof offlinePackageRecordSchema>;
export type OfflinePackageMutationResponse = z.infer<typeof offlinePackageMutationResponseSchema>;
export type OfflinePackageResponse = z.infer<typeof offlinePackageResponseSchema>;
export type OfflinePackagePlace = z.infer<typeof offlinePackagePlaceSchema>;
export type OfflinePackageSource = z.infer<typeof offlinePackageSourceSchema>;
