import { z } from "zod";

import { destinationSearchResultSchema } from "./destinations";
import {
  tripBudgetSchema,
  tripDateFlexibilitySchema,
  tripLocalDateSchema,
  tripTravelerSummarySchema,
} from "./trips";

const plannerTextSchema = z.string().trim().min(1).max(500);
const plannerApiMetaSchema = z.object({ requestId: z.string().uuid() });

export const tripIntentExtractionInputSchema = z
  .object({
    prompt: z.string().trim().min(20).max(5_000),
    locale: z.string().trim().min(2).max(35).default("en"),
    timeZone: z.string().trim().min(1).max(100).default("UTC"),
  })
  .strict();

export const tripIntentDestinationSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    selectedPlaceId: z.string().uuid().nullable(),
    candidates: z.array(destinationSearchResultSchema).max(5),
  })
  .strict();

export const tripIntentAssumptionSchema = z
  .object({
    field: z.string().trim().min(1).max(100),
    summary: plannerTextSchema,
  })
  .strict();

export const tripIntentIssueSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    field: z.string().trim().min(1).max(100),
    message: plannerTextSchema,
    severity: z.enum(["warning", "blocking"]),
  })
  .strict();

export const tripIntentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).nullable(),
    destinations: z.array(tripIntentDestinationSchema).max(10),
    startDate: tripLocalDateSchema.nullable(),
    endDate: tripLocalDateSchema.nullable(),
    dateFlexibility: tripDateFlexibilitySchema,
    travelers: tripTravelerSummarySchema.nullable(),
    budget: tripBudgetSchema.nullable(),
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
  })
  .strict();

export const tripIntentExtractionSchema = z
  .object({
    intent: tripIntentSchema,
    assumptions: z.array(tripIntentAssumptionSchema).max(30),
    issues: z.array(tripIntentIssueSchema).max(50),
    status: z.enum(["ready", "needs_review", "unsupported"]),
  })
  .strict();

export const tripIntentExtractionResponseSchema = z
  .object({
    data: tripIntentExtractionSchema,
    meta: plannerApiMetaSchema,
  })
  .strict();

export type TripIntentExtractionInput = z.infer<typeof tripIntentExtractionInputSchema>;
export type TripIntentDestination = z.infer<typeof tripIntentDestinationSchema>;
export type TripIntentIssue = z.infer<typeof tripIntentIssueSchema>;
export type TripIntent = z.infer<typeof tripIntentSchema>;
export type TripIntentExtraction = z.infer<typeof tripIntentExtractionSchema>;
export type TripIntentExtractionResponse = z.infer<typeof tripIntentExtractionResponseSchema>;
