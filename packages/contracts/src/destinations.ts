import { z } from "zod";

const destinationApiMetaSchema = z.object({ requestId: z.string().uuid() });

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
  url: z.string().url(),
  kind: z.enum([
    "official_authority",
    "official_operator",
    "licensed_provider",
    "reviewed_editorial",
  ]),
  attribution: z.string().nullable(),
  license: z.string().nullable(),
  licenseUrl: z.string().url().nullable(),
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
export type DestinationSearchResponse = z.infer<typeof destinationSearchResponseSchema>;
export type DestinationDetailResponse = z.infer<typeof destinationDetailResponseSchema>;
