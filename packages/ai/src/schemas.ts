import { z } from "zod";

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a local date in YYYY-MM-DD format.");
const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a local time in HH:mm format.");
const identifier = z.string().trim().min(1).max(128);
const shortText = z.string().trim().min(1).max(500);

export const aiSourceReferenceSchema = z
  .object({
    sourceId: identifier,
    title: z.string().trim().min(1).max(240),
    url: z.url(),
    retrievedAt: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }).nullable(),
    official: z.boolean(),
  })
  .strict();

const confidenceSchema = z
  .object({
    level: z.enum(["high", "medium", "low", "unknown"]),
    explanation: shortText,
  })
  .strict();

const itineraryCostSchema = z
  .object({
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    minimumAmount: z.number().nonnegative(),
    maximumAmount: z.number().nonnegative().nullable(),
  })
  .strict();

const itineraryBookingSchema = z
  .object({
    required: z.boolean(),
    status: z.enum(["not_needed", "recommended", "required", "unknown"]),
    url: z.url().nullable(),
  })
  .strict();

const itineraryPlaceSchema = z
  .object({
    placeId: identifier.nullable(),
    name: z.string().trim().min(1).max(240),
    address: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

const itineraryItemSchema = z
  .object({
    candidateId: identifier,
    itemType: z.enum(["accommodation", "activity", "break", "meal", "transport", "other"]),
    title: z.string().trim().min(1).max(240),
    place: itineraryPlaceSchema.nullable(),
    startTime: localTime.nullable(),
    endTime: localTime.nullable(),
    durationMinutes: z.number().int().positive().max(1_440).nullable(),
    estimatedCost: itineraryCostSchema.nullable(),
    booking: itineraryBookingSchema.nullable(),
    notes: z.string().trim().max(1_000).nullable(),
    sourceIds: z.array(identifier).min(1).max(20),
    confidence: confidenceSchema,
  })
  .strict();

const itineraryDaySchema = z
  .object({
    candidateId: identifier,
    localDate,
    timezone: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(240),
    notes: z.string().trim().max(1_000).nullable(),
    items: z.array(itineraryItemSchema).max(40),
  })
  .strict();

const itineraryAssumptionSchema = z
  .object({
    code: identifier,
    summary: shortText,
    needsConfirmation: z.boolean(),
  })
  .strict();

const itineraryWarningSchema = z
  .object({
    code: identifier,
    severity: z.enum(["info", "warning", "blocking"]),
    summary: shortText,
    candidateIds: z.array(identifier).max(20),
  })
  .strict();

export const ITINERARY_OUTPUT_SCHEMA_VERSION = "roavia.itinerary.v1" as const;

export const itineraryOutputV1Schema = z
  .object({
    schemaVersion: z.literal(ITINERARY_OUTPUT_SCHEMA_VERSION),
    title: z.string().trim().min(1).max(240),
    days: z.array(itineraryDaySchema).min(1).max(90),
    assumptions: z.array(itineraryAssumptionSchema).max(30),
    warnings: z.array(itineraryWarningSchema).max(50),
    sources: z.array(aiSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((output, context) => {
    const knownSourceIds = new Set<string>();
    for (const [index, source] of output.sources.entries()) {
      if (knownSourceIds.has(source.sourceId)) {
        context.addIssue({
          code: "custom",
          message: "Source identifiers must be unique.",
          path: ["sources", index, "sourceId"],
        });
      }
      knownSourceIds.add(source.sourceId);
    }
    for (const [dayIndex, day] of output.days.entries()) {
      for (const [itemIndex, item] of day.items.entries()) {
        for (const [sourceIndex, sourceId] of item.sourceIds.entries()) {
          if (!knownSourceIds.has(sourceId)) {
            context.addIssue({
              code: "custom",
              message: "Itinerary item references an unknown source.",
              path: ["days", dayIndex, "items", itemIndex, "sourceIds", sourceIndex],
            });
          }
        }
      }
    }
  });

export type ItineraryOutputV1 = z.infer<typeof itineraryOutputV1Schema>;

const assistantClaimSchema = z
  .object({
    claimId: identifier,
    text: z.string().trim().min(1).max(1_000),
    sourceIds: z.array(identifier).min(1).max(20),
    confidence: confidenceSchema,
  })
  .strict();

const assistantActionParameterSchema = z.union([
  z.string().max(1_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const assistantActionSchema = z
  .object({
    actionId: identifier,
    kind: z.enum(["add_place", "remove_item", "reorder_item", "replace_item", "save_note"]),
    summary: shortText,
    requiresConfirmation: z.literal(true),
    parameters: z.record(z.string().min(1).max(80), assistantActionParameterSchema),
    sourceIds: z.array(identifier).min(1).max(20),
  })
  .strict();

const assistantSafetySchema = z
  .object({
    classification: z.enum(["general", "high_stakes", "refusal"]),
    explanation: shortText,
    officialSourceRequired: z.boolean(),
  })
  .strict();

export const ASSISTANT_OUTPUT_SCHEMA_VERSION = "roavia.assistant.v1" as const;

export const assistantOutputV1Schema = z
  .object({
    schemaVersion: z.literal(ASSISTANT_OUTPUT_SCHEMA_VERSION),
    answer: z.string().trim().min(1).max(8_000),
    claims: z.array(assistantClaimSchema).max(50),
    sources: z.array(aiSourceReferenceSchema).max(100),
    uncertainty: z
      .object({
        level: z.enum(["low", "medium", "high"]),
        explanation: shortText,
      })
      .strict(),
    safety: assistantSafetySchema,
    suggestedActions: z.array(assistantActionSchema).max(10),
  })
  .strict()
  .superRefine((output, context) => {
    const refusal = output.safety.classification === "refusal";
    if (
      refusal &&
      (output.claims.length > 0 ||
        output.sources.length > 0 ||
        output.suggestedActions.length > 0 ||
        output.safety.officialSourceRequired)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Assistant refusals cannot include claims, sources, actions, or source requirements.",
        path: ["safety", "classification"],
      });
    }
    if (!refusal && (output.claims.length === 0 || output.sources.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "Assistant answers require at least one sourced claim.",
        path: [output.claims.length === 0 ? "claims" : "sources"],
      });
    }
    const knownSourceIds = new Set<string>();
    for (const [index, source] of output.sources.entries()) {
      if (knownSourceIds.has(source.sourceId)) {
        context.addIssue({
          code: "custom",
          message: "Source identifiers must be unique.",
          path: ["sources", index, "sourceId"],
        });
      }
      knownSourceIds.add(source.sourceId);
    }
    for (const [claimIndex, claim] of output.claims.entries()) {
      for (const [sourceIndex, sourceId] of claim.sourceIds.entries()) {
        if (!knownSourceIds.has(sourceId)) {
          context.addIssue({
            code: "custom",
            message: "Assistant claim references an unknown source.",
            path: ["claims", claimIndex, "sourceIds", sourceIndex],
          });
        }
      }
    }
    for (const [actionIndex, action] of output.suggestedActions.entries()) {
      for (const [sourceIndex, sourceId] of action.sourceIds.entries()) {
        if (!knownSourceIds.has(sourceId)) {
          context.addIssue({
            code: "custom",
            message: "Assistant action references an unknown source.",
            path: ["suggestedActions", actionIndex, "sourceIds", sourceIndex],
          });
        }
      }
    }
    if (output.safety.classification === "high_stakes" && !output.safety.officialSourceRequired) {
      context.addIssue({
        code: "custom",
        message: "High-stakes output must require an official source.",
        path: ["safety", "officialSourceRequired"],
      });
    }
    if (output.safety.officialSourceRequired && !output.sources.some((source) => source.official)) {
      context.addIssue({
        code: "custom",
        message: "High-stakes output requires at least one official source.",
        path: ["sources"],
      });
    }
  });

export type AssistantOutputV1 = z.infer<typeof assistantOutputV1Schema>;

export const TRIP_INTENT_OUTPUT_SCHEMA_VERSION = "roavia.trip-intent.v1" as const;

const tripIntentAssumptionSchema = z
  .object({
    field: identifier,
    summary: shortText,
  })
  .strict();

export const tripIntentOutputV1Schema = z
  .object({
    schemaVersion: z.literal(TRIP_INTENT_OUTPUT_SCHEMA_VERSION),
    title: z.string().trim().min(1).max(200).nullable(),
    destinations: z.array(z.string().trim().min(1).max(100)).max(10),
    startDate: localDate.nullable(),
    endDate: localDate.nullable(),
    dateFlexibility: z
      .object({
        daysBefore: z.number().int().min(0).max(365),
        daysAfter: z.number().int().min(0).max(365),
      })
      .strict(),
    travelers: z
      .object({
        adults: z.number().int().min(0).max(50),
        children: z.number().int().min(0).max(50),
        infants: z.number().int().min(0).max(10),
      })
      .strict()
      .nullable(),
    budget: z
      .object({
        amountMinor: z.number().int().min(0).max(100_000_000_000).nullable(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        style: z.enum(["budget", "midrange", "premium", "luxury"]),
      })
      .strict()
      .nullable(),
    pace: z.enum(["slow", "balanced", "fast"]).nullable(),
    interests: z.array(z.string().trim().min(1).max(100)).max(20),
    constraints: z
      .object({
        accessibility: z.array(z.string().trim().min(1).max(200)).max(20),
        dietary: z.array(z.string().trim().min(1).max(200)).max(20),
        mustAvoid: z.array(z.string().trim().min(1).max(200)).max(20),
        mustDo: z.array(z.string().trim().min(1).max(200)).max(20),
      })
      .strict(),
    assumptions: z.array(tripIntentAssumptionSchema).max(30),
    unsupportedRequests: z.array(shortText).max(20),
  })
  .strict();

export type TripIntentOutputV1 = z.infer<typeof tripIntentOutputV1Schema>;
