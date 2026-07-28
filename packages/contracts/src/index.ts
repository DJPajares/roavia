import { z } from "zod";

export const API_CONTRACT_VERSION = "v1" as const;

export const requestIdSchema = z.string().uuid();

export const apiMetaSchema = z.object({
  requestId: requestIdSchema,
});

export const apiErrorCodeSchema = z.enum(["bad_request", "not_found", "internal_error"]);

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

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type RequestId = z.infer<typeof requestIdSchema>;
