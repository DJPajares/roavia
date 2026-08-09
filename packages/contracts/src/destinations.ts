import { z } from "zod";

import { httpsUrlSchema } from "./security";

const destinationApiMetaSchema = z.object({ requestId: z.string().uuid() });

export const seasonalPrioritySchema = z.object({
  budget: z.coerce.number().min(0).max(5).optional(),
  closures: z.coerce.number().min(0).max(5).optional(),
  crowds: z.coerce.number().min(0).max(5).optional(),
  festivals: z.coerce.number().min(0).max(5).optional(),
  weather: z.coerce.number().min(0).max(5).optional(),
});

export const destinationSeasonalityQuerySchema = seasonalPrioritySchema;

const seasonalSignalSchema = z.enum([
  "weather",
  "rainfall",
  "temperature",
  "crowds",
  "prices",
  "festivals",
  "holidays",
  "closures",
]);

const seasonalSignalEvidenceSchema = z.object({
  confidence: z.number().min(0).max(1),
  favorability: z.number().min(0).max(1).nullable(),
  precision: z.enum(["estimated", "measured", "qualitative"]),
  refreshedAt: z.string().datetime({ offset: true }),
  signal: seasonalSignalSchema,
  sourceId: z.string().min(1),
  staleAt: z.string().datetime({ offset: true }).optional(),
  summary: z.string().min(1),
});

const seasonalSignalInsightSchema = z.object({
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.array(seasonalSignalEvidenceSchema),
  favorability: z.number().min(0).max(1).nullable(),
  refreshedAt: z.string().datetime({ offset: true }).nullable(),
  sourceIds: z.array(z.string().min(1)),
  state: z.enum(["available", "conflicting", "missing", "stale"]),
});

export const destinationSeasonalInsightSchema = z.object({
  confidence: z.number().min(0).max(1),
  explanation: z.object({
    caveats: z.array(z.string().min(1)),
    summary: z.string().min(1),
    tradeoffs: z.array(z.string().min(1)),
  }),
  period: z.discriminatedUnion("kind", [
    z.object({
      endDate: z.string().date(),
      kind: z.literal("date_range"),
      startDate: z.string().date(),
    }),
    z.object({
      kind: z.literal("month"),
      month: z.number().int().min(1).max(12),
      year: z.number().int(),
    }),
  ]),
  periodKey: z.string().min(1),
  placeId: z.string().uuid(),
  priorities: z.object({
    budget: z.number().min(0).max(5),
    closures: z.number().min(0).max(5),
    crowds: z.number().min(0).max(5),
    festivals: z.number().min(0).max(5),
    weather: z.number().min(0).max(5),
  }),
  rating: z.enum(["challenging", "favorable", "insufficient_evidence", "mixed", "very_favorable"]),
  refreshedAt: z.string().datetime({ offset: true }),
  score: z.number().min(0).max(1).nullable(),
  signals: z.record(seasonalSignalSchema, seasonalSignalInsightSchema),
  sourceIds: z.array(z.string().min(1)),
});

export const destinationSeasonalityDataSchema = z.object({
  insights: z.array(destinationSeasonalInsightSchema),
});

export const destinationSeasonalityResponseSchema = z.object({
  data: destinationSeasonalityDataSchema,
  meta: destinationApiMetaSchema,
});

export const destinationPlaceTypeSchema = z.enum([
  "country",
  "region",
  "city",
  "district",
  "poi",
  "transit_hub",
]);

export const destinationSearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(100),
  page: z.coerce.number().int().min(1).max(100).default(1),
  limit: z.coerce.number().int().min(1).max(25).default(10),
  types: z.array(destinationPlaceTypeSchema).max(6).default([]),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase())
    .optional(),
  regionId: z.string().uuid().optional(),
});

export const destinationHierarchyItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: destinationPlaceTypeSchema,
});

export const destinationSearchResultSchema = z.object({
  id: z.string().uuid(),
  canonicalName: z.string().min(1),
  localizedNames: z.record(z.string(), z.string()),
  placeType: destinationPlaceTypeSchema,
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  hierarchy: z.array(destinationHierarchyItemSchema),
});

export const destinationSearchDataSchema = z.object({
  query: z.string().min(1),
  results: z.array(destinationSearchResultSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
    nextPage: z.number().int().min(1).nullable(),
  }),
});

export const destinationSearchResponseSchema = z.object({
  data: destinationSearchDataSchema,
  meta: destinationApiMetaSchema,
});

const destinationSourceSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  url: httpsUrlSchema,
  kind: z.enum([
    "official_authority",
    "official_operator",
    "licensed_provider",
    "reviewed_editorial",
  ]),
  attribution: z.string().nullable(),
  license: z.string().nullable(),
  licenseUrl: httpsUrlSchema.nullable(),
  retrievedAt: z.string().datetime(),
});

export const destinationDetailDataSchema = z.object({
  place: z.object({
    id: z.string().uuid(),
    canonicalName: z.string().min(1),
    localizedNames: z.record(z.string(), z.string()),
    placeType: destinationPlaceTypeSchema,
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    timezone: z.string().nullable(),
    summary: z.string().nullable(),
    hierarchy: z.array(destinationHierarchyItemSchema),
  }),
  content: z.array(
    z.object({
      id: z.string().uuid(),
      type: z.string().min(1),
      data: z.record(z.string(), z.unknown()),
      freshness: z.enum(["fresh", "stale"]),
      refreshedAt: z.string().datetime(),
      sources: z.array(destinationSourceSchema),
    }),
  ),
});

export const destinationDetailResponseSchema = z.object({
  data: destinationDetailDataSchema,
  meta: destinationApiMetaSchema,
});

export type DestinationPlaceType = z.infer<typeof destinationPlaceTypeSchema>;
export type DestinationSearchQuery = z.infer<typeof destinationSearchQuerySchema>;
export type DestinationSearchResult = z.infer<typeof destinationSearchResultSchema>;
export type DestinationSearchResponse = z.infer<typeof destinationSearchResponseSchema>;
export type DestinationDetailResponse = z.infer<typeof destinationDetailResponseSchema>;
export type DestinationSeasonalInsight = z.infer<typeof destinationSeasonalInsightSchema>;
export type DestinationSeasonalityQuery = z.infer<typeof destinationSeasonalityQuerySchema>;
export type DestinationSeasonalityResponse = z.infer<typeof destinationSeasonalityResponseSchema>;
