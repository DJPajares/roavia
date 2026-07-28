import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const tripApiMetaSchema = z.object({ requestId: z.string().uuid() });

function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function hasMutationField(value: Record<string, unknown>, concurrencyField: string): boolean {
  return Object.keys(value).some((key) => key !== concurrencyField);
}

export const tripIdSchema = z.string().uuid();
export const tripRevisionSchema = z.number().int().min(1);
export const tripStatusSchema = z.enum(["draft", "active", "archived"]);
export const tripVisibilitySchema = z.enum(["private", "link"]);
export const tripGenerationStateSchema = z.enum([
  "idle",
  "queued",
  "generating",
  "ready",
  "failed",
]);
export const tripItemTypeSchema = z.enum(["activity", "food", "lodging", "transport", "note"]);
export const tripLocalDateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN)
  .refine(isCalendarDate, "Invalid calendar date.");
export const tripLocalTimeSchema = z.string().regex(LOCAL_TIME_PATTERN);
export const tripTimeZoneSchema = z.string().trim().min(1).max(100).refine(isTimeZone, {
  message: "Invalid IANA time zone.",
});
export const tripCurrencySchema = z.string().regex(CURRENCY_PATTERN);
export const tripJsonObjectSchema = z.record(z.string(), z.unknown());

export const itineraryCoordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const itinerarySourceSchema = z.object({
  freshness: z.enum(["fresh", "stale"]),
  label: z.string().trim().min(1).max(200),
  retrievedAt: z.string().datetime({ offset: true }),
  url: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://") || value.startsWith("http://"), {
      message: "Source URL must use HTTP or HTTPS.",
    })
    .optional(),
});

export const itineraryItemSourceSnapshotSchema = z.object({
  place: z
    .object({
      address: z.string().trim().min(1).max(500).optional(),
      coordinates: itineraryCoordinatesSchema.optional(),
      name: z.string().trim().min(1).max(300),
    })
    .optional(),
  source: itinerarySourceSchema.optional(),
});

const itineraryRouteAvailableSchema = z.object({
  availability: z.literal("available"),
  confidence: z.object({
    explanation: z.string().trim().min(1).max(1_000),
    level: z.literal("provider_estimate"),
  }),
  distanceMeters: z.number().min(0),
  durationSeconds: z.number().min(0),
  freshness: z.enum(["fresh", "stale"]).default("fresh"),
  geometry: z
    .object({
      coordinates: z.array(itineraryCoordinatesSchema).min(2),
      type: z.literal("LineString"),
    })
    .optional(),
  mode: z.enum(["cycling", "driving", "walking"]),
  retrievedAt: z.string().datetime({ offset: true }),
  trafficBasis: z.enum(["current_and_historical", "none"]),
  waypoints: z.array(itineraryCoordinatesSchema).min(2),
});

const itineraryRouteUnavailableSchema = z.object({
  availability: z.enum(["provider_unavailable", "route_unavailable"]),
  reason: z.string().trim().min(1).max(1_000),
});

export const itineraryRouteSnapshotSchema = z.discriminatedUnion("availability", [
  itineraryRouteAvailableSchema,
  itineraryRouteUnavailableSchema,
]);

export const tripDateFlexibilitySchema = z.object({
  daysBefore: z.number().int().min(0).max(365).default(0),
  daysAfter: z.number().int().min(0).max(365).default(0),
});

export const tripTravelerSummarySchema = z
  .object({
    adults: z.number().int().min(0).max(50),
    children: z.number().int().min(0).max(50).default(0),
    infants: z.number().int().min(0).max(10).default(0),
  })
  .refine(
    ({ adults, children, infants }) => {
      const total = adults + children + infants;
      return total >= 1 && total <= 50;
    },
    { message: "A trip requires between 1 and 50 travelers." },
  );

export const tripBudgetSchema = z.object({
  currency: tripCurrencySchema,
  amountMinor: z.number().int().min(0).max(100_000_000_000).nullable().default(null),
  style: z.enum(["budget", "midrange", "premium", "luxury"]),
});

export const tripMoneySchema = z.object({
  currency: tripCurrencySchema,
  amountMinor: z.number().int().min(0).max(100_000_000_000),
});

const tripDatesSchema = z.object({
  startDate: tripLocalDateSchema,
  endDate: tripLocalDateSchema,
});

function validateDateOrder(
  value: { endDate?: string; startDate?: string },
  context: z.RefinementCtx,
) {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    context.addIssue({
      code: "custom",
      message: "Trip end date cannot be before its start date.",
      path: ["endDate"],
    });
  }
}

export const tripCreateInputSchema = tripDatesSchema
  .extend({
    title: z.string().trim().min(1).max(200),
    originPlaceId: z.string().uuid().nullable().default(null),
    dateFlexibility: tripDateFlexibilitySchema.default({ daysAfter: 0, daysBefore: 0 }),
    travelerSummary: tripTravelerSummarySchema,
    budget: tripBudgetSchema,
    status: tripStatusSchema.default("draft"),
    visibility: tripVisibilitySchema.default("private"),
  })
  .superRefine(validateDateOrder);

export const tripUpdateInputSchema = z
  .object({
    expectedRevision: tripRevisionSchema,
    title: z.string().trim().min(1).max(200).optional(),
    originPlaceId: z.string().uuid().nullable().optional(),
    startDate: tripLocalDateSchema.optional(),
    endDate: tripLocalDateSchema.optional(),
    dateFlexibility: tripDateFlexibilitySchema.optional(),
    travelerSummary: tripTravelerSummarySchema.optional(),
    budget: tripBudgetSchema.optional(),
    status: tripStatusSchema.optional(),
    visibility: tripVisibilitySchema.optional(),
  })
  .superRefine((value, context) => {
    validateDateOrder(value, context);
    if (!hasMutationField(value, "expectedRevision")) {
      context.addIssue({ code: "custom", message: "At least one trip field must be updated." });
    }
  });

export const tripDeleteInputSchema = z.object({ expectedRevision: tripRevisionSchema });

export const tripListQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: tripStatusSchema.optional(),
});

export const tripSchema = z.object({
  id: tripIdSchema,
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(120),
  originPlaceId: z.string().uuid().nullable(),
  startDate: tripLocalDateSchema,
  endDate: tripLocalDateSchema,
  dateFlexibility: tripDateFlexibilitySchema,
  travelerSummary: tripTravelerSummarySchema,
  budget: tripBudgetSchema,
  status: tripStatusSchema,
  visibility: tripVisibilitySchema,
  generationState: tripGenerationStateSchema,
  revision: tripRevisionSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

function validateTimestampPair(
  value: { arrivalAt?: string | null; departureAt?: string | null },
  context: z.RefinementCtx,
) {
  if (
    value.arrivalAt !== undefined &&
    value.departureAt !== undefined &&
    value.arrivalAt !== null &&
    value.departureAt !== null &&
    new Date(value.departureAt) <= new Date(value.arrivalAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Departure must be after arrival.",
      path: ["departureAt"],
    });
  }
}

export const tripDestinationCreateInputSchema = z
  .object({
    expectedTripRevision: tripRevisionSchema,
    placeId: z.string().uuid(),
    arrivalAt: z.string().datetime({ offset: true }).nullable().default(null),
    departureAt: z.string().datetime({ offset: true }).nullable().default(null),
    orderIndex: z.number().int().min(0).max(9_999).optional(),
  })
  .superRefine(validateTimestampPair);

export const tripDestinationUpdateInputSchema = z
  .object({
    expectedTripRevision: tripRevisionSchema,
    placeId: z.string().uuid().optional(),
    arrivalAt: z.string().datetime({ offset: true }).nullable().optional(),
    departureAt: z.string().datetime({ offset: true }).nullable().optional(),
    orderIndex: z.number().int().min(0).max(9_999).optional(),
  })
  .superRefine((value, context) => {
    validateTimestampPair(value, context);
    if (!hasMutationField(value, "expectedTripRevision")) {
      context.addIssue({
        code: "custom",
        message: "At least one destination field must be updated.",
      });
    }
  });

export const tripChildDeleteInputSchema = z.object({ expectedTripRevision: tripRevisionSchema });

export const tripDestinationSchema = z.object({
  id: z.string().uuid(),
  tripId: tripIdSchema,
  placeId: z.string().uuid(),
  arrivalAt: z.string().datetime({ offset: true }).nullable(),
  departureAt: z.string().datetime({ offset: true }).nullable(),
  orderIndex: z.number().int().min(0),
});

export const tripDayCreateInputSchema = z.object({
  expectedTripRevision: tripRevisionSchema,
  localDate: tripLocalDateSchema,
  timezone: tripTimeZoneSchema,
  title: z.string().trim().min(1).max(200).nullable().default(null),
  notes: z.string().max(10_000).nullable().default(null),
  orderIndex: z.number().int().min(0).max(9_999).optional(),
});

export const tripDayUpdateInputSchema = z
  .object({
    expectedTripRevision: tripRevisionSchema,
    localDate: tripLocalDateSchema.optional(),
    timezone: tripTimeZoneSchema.optional(),
    title: z.string().trim().min(1).max(200).nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(),
    orderIndex: z.number().int().min(0).max(9_999).optional(),
  })
  .refine((value) => hasMutationField(value, "expectedTripRevision"), {
    message: "At least one itinerary-day field must be updated.",
  });

export const tripItemCreateInputSchema = z
  .object({
    expectedTripRevision: tripRevisionSchema,
    itineraryDayId: z.string().uuid(),
    placeId: z.string().uuid().nullable().default(null),
    itemType: tripItemTypeSchema,
    startTime: tripLocalTimeSchema.nullable().default(null),
    endTime: tripLocalTimeSchema.nullable().default(null),
    durationMinutes: z.number().int().min(1).max(10_080).nullable().default(null),
    estimatedCost: tripMoneySchema.nullable().default(null),
    transport: tripJsonObjectSchema.default({}),
    booking: tripJsonObjectSchema.default({}),
    sourceSnapshot: tripJsonObjectSchema.default({}),
    confidence: z.number().min(0).max(1).nullable().default(null),
    notes: z.string().max(10_000).nullable().default(null),
    orderIndex: z.number().int().min(0).max(9_999).optional(),
  })
  .refine(({ endTime, startTime }) => (startTime === null) === (endTime === null), {
    message: "Start and end time must be provided together.",
    path: ["endTime"],
  })
  .refine(
    ({ endTime, startTime }) => startTime === null || endTime === null || endTime > startTime,
    { message: "End time must be after start time.", path: ["endTime"] },
  );

export const tripItemUpdateInputSchema = z
  .object({
    expectedTripRevision: tripRevisionSchema,
    itineraryDayId: z.string().uuid().optional(),
    placeId: z.string().uuid().nullable().optional(),
    itemType: tripItemTypeSchema.optional(),
    startTime: tripLocalTimeSchema.nullable().optional(),
    endTime: tripLocalTimeSchema.nullable().optional(),
    durationMinutes: z.number().int().min(1).max(10_080).nullable().optional(),
    estimatedCost: tripMoneySchema.nullable().optional(),
    transport: tripJsonObjectSchema.optional(),
    booking: tripJsonObjectSchema.optional(),
    sourceSnapshot: tripJsonObjectSchema.optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(),
    orderIndex: z.number().int().min(0).max(9_999).optional(),
  })
  .refine((value) => hasMutationField(value, "expectedTripRevision"), {
    message: "At least one itinerary-item field must be updated.",
  });

export const tripItemSchema = z.object({
  id: z.string().uuid(),
  itineraryDayId: z.string().uuid(),
  placeId: z.string().uuid().nullable(),
  itemType: tripItemTypeSchema,
  startTime: tripLocalTimeSchema.nullable(),
  endTime: tripLocalTimeSchema.nullable(),
  durationMinutes: z.number().int().min(1).nullable(),
  estimatedCost: tripMoneySchema.nullable(),
  transport: tripJsonObjectSchema,
  booking: tripJsonObjectSchema,
  sourceSnapshot: tripJsonObjectSchema,
  confidence: z.number().min(0).max(1).nullable(),
  notes: z.string().nullable(),
  orderIndex: z.number().int().min(0),
});

export const tripDaySchema = z.object({
  id: z.string().uuid(),
  tripId: tripIdSchema,
  localDate: tripLocalDateSchema,
  timezone: tripTimeZoneSchema,
  title: z.string().nullable(),
  notes: z.string().nullable(),
  orderIndex: z.number().int().min(0),
  items: z.array(tripItemSchema),
});

export const tripDetailSchema = tripSchema.extend({
  destinations: z.array(tripDestinationSchema),
  days: z.array(tripDaySchema),
});

export const tripListDataSchema = z.object({
  trips: z.array(tripSchema),
  pagination: z.object({
    limit: z.number().int().min(1).max(50),
    nextCursor: z.string().nullable(),
  }),
});

export const tripResponseSchema = z.object({ data: tripDetailSchema, meta: tripApiMetaSchema });
export const tripListResponseSchema = z.object({
  data: tripListDataSchema,
  meta: tripApiMetaSchema,
});
export const tripDestinationMutationResponseSchema = z.object({
  data: z.object({ destination: tripDestinationSchema, tripRevision: tripRevisionSchema }),
  meta: tripApiMetaSchema,
});
export const tripDayMutationResponseSchema = z.object({
  data: z.object({ day: tripDaySchema, tripRevision: tripRevisionSchema }),
  meta: tripApiMetaSchema,
});
export const tripItemMutationResponseSchema = z.object({
  data: z.object({ item: tripItemSchema, tripRevision: tripRevisionSchema }),
  meta: tripApiMetaSchema,
});
export const tripChildDeleteResponseSchema = z.object({
  data: z.object({ deletedId: z.string().uuid(), tripRevision: tripRevisionSchema }),
  meta: tripApiMetaSchema,
});
export const tripDeleteResponseSchema = z.object({
  data: z.object({ deletedId: tripIdSchema }),
  meta: tripApiMetaSchema,
});

export type Trip = z.infer<typeof tripSchema>;
export type TripDetail = z.infer<typeof tripDetailSchema>;
export type TripCreateInput = z.infer<typeof tripCreateInputSchema>;
export type TripUpdateInput = z.infer<typeof tripUpdateInputSchema>;
export type TripDeleteInput = z.infer<typeof tripDeleteInputSchema>;
export type TripListQuery = z.infer<typeof tripListQuerySchema>;
export type TripListData = z.infer<typeof tripListDataSchema>;
export type TripResponse = z.infer<typeof tripResponseSchema>;
export type TripListResponse = z.infer<typeof tripListResponseSchema>;
export type TripDeleteResponse = z.infer<typeof tripDeleteResponseSchema>;
export type TripDestination = z.infer<typeof tripDestinationSchema>;
export type TripDestinationCreateInput = z.infer<typeof tripDestinationCreateInputSchema>;
export type TripDestinationUpdateInput = z.infer<typeof tripDestinationUpdateInputSchema>;
export type TripChildDeleteInput = z.infer<typeof tripChildDeleteInputSchema>;
export type TripDay = z.infer<typeof tripDaySchema>;
export type TripDayCreateInput = z.infer<typeof tripDayCreateInputSchema>;
export type TripDayUpdateInput = z.infer<typeof tripDayUpdateInputSchema>;
export type TripItem = z.infer<typeof tripItemSchema>;
export type TripItemCreateInput = z.infer<typeof tripItemCreateInputSchema>;
export type TripItemUpdateInput = z.infer<typeof tripItemUpdateInputSchema>;
export type ItineraryCoordinates = z.infer<typeof itineraryCoordinatesSchema>;
export type ItineraryItemSourceSnapshot = z.infer<typeof itineraryItemSourceSnapshotSchema>;
export type ItineraryRouteSnapshot = z.infer<typeof itineraryRouteSnapshotSchema>;
export type ItinerarySource = z.infer<typeof itinerarySourceSchema>;
