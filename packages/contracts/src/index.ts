import { z } from "zod";

export * from "./trips";
export * from "./profile";
export * from "./sharing";

export const API_CONTRACT_VERSION = "v1" as const;

export const requestIdSchema = z.string().uuid();

export const apiMetaSchema = z.object({
  requestId: requestIdSchema,
});

export const apiErrorCodeSchema = z.enum([
  "authentication_required",
  "bad_request",
  "conflict",
  "internal_error",
  "invalid_session",
  "generation_service_unavailable",
  "not_found",
  "profile_service_unavailable",
  "rate_limited",
  "search_unavailable",
  "session_expired",
  "share_service_unavailable",
  "trip_service_unavailable",
]);

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string().min(1),
  requestId: requestIdSchema,
});

export const apiErrorResponseSchema = z.object({
  error: apiErrorSchema,
});

export const healthDataSchema = z.object({
  service: z.literal("api"),
  status: z.literal("ok"),
  version: z.literal(API_CONTRACT_VERSION),
});

export const healthResponseSchema = z.object({
  data: healthDataSchema,
  meta: apiMetaSchema,
});

export const authIdentitySchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email().optional(),
});

export const authCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const authSessionDataSchema = z.object({
  identity: authIdentitySchema,
  expiresAt: z.string().datetime({ offset: true }),
});

export const authSessionResponseSchema = z.object({
  data: authSessionDataSchema,
  meta: apiMetaSchema,
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
  meta: apiMetaSchema,
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type AuthIdentity = z.infer<typeof authIdentitySchema>;
export type AuthCredentials = z.infer<typeof authCredentialsSchema>;
export type AuthSession = z.infer<typeof authSessionDataSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type DestinationPlaceType = z.infer<typeof destinationPlaceTypeSchema>;
export type DestinationSearchQuery = z.infer<typeof destinationSearchQuerySchema>;
export type DestinationSearchResponse = z.infer<typeof destinationSearchResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type RequestId = z.infer<typeof requestIdSchema>;
