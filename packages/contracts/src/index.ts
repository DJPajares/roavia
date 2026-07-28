import { z } from "zod";

export const API_CONTRACT_VERSION = "v1" as const;

export const requestIdSchema = z.string().uuid();

export const apiMetaSchema = z.object({
  requestId: requestIdSchema,
});

export const apiErrorCodeSchema = z.enum([
  "authentication_required",
  "bad_request",
  "internal_error",
  "invalid_session",
  "not_found",
  "session_expired",
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

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type AuthIdentity = z.infer<typeof authIdentitySchema>;
export type AuthCredentials = z.infer<typeof authCredentialsSchema>;
export type AuthSession = z.infer<typeof authSessionDataSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type RequestId = z.infer<typeof requestIdSchema>;
