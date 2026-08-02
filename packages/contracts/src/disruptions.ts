import { z } from "zod";

import { httpsUrlSchema } from "./security";

const identifierSchema = z.string().uuid();
const shortTextSchema = z.string().trim().min(1).max(1_000);
const sourceSchema = z
  .object({
    retrievedAt: z.string().datetime({ offset: true }),
    sourceId: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(300),
    updatedAt: z.string().datetime({ offset: true }),
    url: httpsUrlSchema,
  })
  .strict();

const comparisonItemSchema = z
  .object({
    itemId: identifierSchema.optional(),
    itemType: z.enum(["activity", "food", "lodging", "transport", "note"]),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    name: z.string().trim().min(1).max(300),
    placeId: identifierSchema,
    timeLabel: z.string().trim().min(1).max(100),
  })
  .strict();

export const disruptionRecommendationSnapshotSchema = z
  .object({
    alternative: comparisonItemSchema
      .omit({ itemId: true })
      .extend({
        explanation: shortTextSchema,
        source: sourceSchema,
      })
      .strict(),
    confidence: z
      .object({
        explanation: shortTextSchema,
        level: z.enum(["high", "medium"]),
        score: z.number().min(0.75).max(1),
      })
      .strict(),
    impact: z
      .object({
        impactId: identifierSchema,
        kind: z.enum(["closure", "weather"]),
        reason: shortTextSchema,
        severity: z.enum(["moderate", "high", "critical"]),
        source: sourceSchema,
      })
      .strict(),
    original: comparisonItemSchema.required({ itemId: true }),
    tripId: identifierSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.original.placeId === snapshot.alternative.placeId) {
      context.addIssue({
        code: "custom",
        message: "A disruption alternative must change the itinerary place.",
        path: ["alternative", "placeId"],
      });
    }
  });

export const disruptionRecommendationStatusSchema = z.enum(["pending", "applying", "failed"]);

export const disruptionRecommendationSchema = disruptionRecommendationSnapshotSchema
  .extend({
    createdAt: z.string().datetime({ offset: true }),
    id: identifierSchema,
    status: disruptionRecommendationStatusSchema,
  })
  .strict();

export const disruptionRecommendationListResponseSchema = z
  .object({
    data: z
      .object({
        liveDataStatus: z.enum(["fresh", "none", "provider_unavailable", "stale"]),
        recommendations: z.array(disruptionRecommendationSchema).max(10),
      })
      .strict(),
    meta: z.object({ requestId: identifierSchema }),
  })
  .strict();

export const disruptionRecommendationDecisionInputSchema = z
  .object({ decision: z.enum(["dismiss", "keep"]) })
  .strict();

export const disruptionRecommendationMutationResponseSchema = z
  .object({
    data: z
      .object({
        recommendationId: identifierSchema,
        status: z.enum(["applied", "dismissed", "failed", "kept"]),
        tripId: identifierSchema,
        tripRevision: z.number().int().min(1).nullable(),
      })
      .strict(),
    meta: z.object({ requestId: identifierSchema }),
  })
  .strict();

export type DisruptionRecommendationSnapshot = z.infer<
  typeof disruptionRecommendationSnapshotSchema
>;
export type DisruptionRecommendation = z.infer<typeof disruptionRecommendationSchema>;
export type DisruptionRecommendationDecisionInput = z.infer<
  typeof disruptionRecommendationDecisionInputSchema
>;
export type DisruptionRecommendationListResponse = z.infer<
  typeof disruptionRecommendationListResponseSchema
>;
export type DisruptionRecommendationMutationResponse = z.infer<
  typeof disruptionRecommendationMutationResponseSchema
>;
