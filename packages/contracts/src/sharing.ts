import { z } from "zod";

import {
  itineraryItemSourceSnapshotSchema,
  itineraryRouteSnapshotSchema,
  tripItemTypeSchema,
  tripLocalDateSchema,
  tripLocalTimeSchema,
  tripMoneySchema,
  tripTimeZoneSchema,
} from "./trips";

const shareApiMetaSchema = z.object({ requestId: z.string().uuid() });

export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const shareLinkIdSchema = z.string().uuid();
export const shareLinkStatusSchema = z.enum(["active", "expired", "revoked"]);

export const shareLinkCreateInputSchema = z.object({
  expiresInDays: z.number().int().min(1).max(180).default(30),
});

export const shareLinkSchema = z.object({
  id: shareLinkIdSchema,
  permission: z.literal("view"),
  status: shareLinkStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
});

export const shareLinkCreateResponseSchema = z.object({
  data: z.object({ link: shareLinkSchema, token: shareTokenSchema }),
  meta: shareApiMetaSchema,
});

export const shareLinkListResponseSchema = z.object({
  data: z.object({ links: z.array(shareLinkSchema) }),
  meta: shareApiMetaSchema,
});

export const shareLinkRevokeResponseSchema = z.object({
  data: z.object({ id: shareLinkIdSchema, revokedAt: z.string().datetime({ offset: true }) }),
  meta: shareApiMetaSchema,
});

export const sharedTripItemSchema = z.object({
  itemType: tripItemTypeSchema,
  startTime: tripLocalTimeSchema.nullable(),
  endTime: tripLocalTimeSchema.nullable(),
  durationMinutes: z.number().int().min(1).nullable(),
  estimatedCost: tripMoneySchema.nullable(),
  sourceSnapshot: itineraryItemSourceSnapshotSchema,
  route: itineraryRouteSnapshotSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  notes: z.string().nullable(),
  orderIndex: z.number().int().min(0),
});

export const sharedTripDaySchema = z.object({
  localDate: tripLocalDateSchema,
  timezone: tripTimeZoneSchema,
  title: z.string().nullable(),
  notes: z.string().nullable(),
  orderIndex: z.number().int().min(0),
  items: z.array(sharedTripItemSchema),
});

export const sharedTripSchema = z.object({
  title: z.string().min(1).max(200),
  startDate: tripLocalDateSchema,
  endDate: tripLocalDateSchema,
  updatedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  days: z.array(sharedTripDaySchema),
});

export const sharedTripResponseSchema = z.object({
  data: sharedTripSchema,
  meta: shareApiMetaSchema,
});

export type ShareLinkCreateInput = z.infer<typeof shareLinkCreateInputSchema>;
export type ShareLink = z.infer<typeof shareLinkSchema>;
export type ShareLinkCreateResponse = z.infer<typeof shareLinkCreateResponseSchema>;
export type ShareLinkListResponse = z.infer<typeof shareLinkListResponseSchema>;
export type ShareLinkRevokeResponse = z.infer<typeof shareLinkRevokeResponseSchema>;
export type SharedTrip = z.infer<typeof sharedTripSchema>;
export type SharedTripResponse = z.infer<typeof sharedTripResponseSchema>;
