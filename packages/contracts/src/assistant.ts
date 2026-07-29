import { z } from "zod";

const assistantMetaSchema = z.object({ requestId: z.string().uuid() });
const identifierSchema = z.string().uuid();
const shortTextSchema = z.string().trim().min(1).max(500);

export const assistantContextSchema = z.discriminatedUnion("type", [
  z.object({ destinationId: identifierSchema, type: z.literal("destination") }).strict(),
  z.object({ tripId: identifierSchema, type: z.literal("trip") }).strict(),
]);

export const assistantQueryInputSchema = z
  .object({
    context: assistantContextSchema,
    locale: z.string().trim().min(2).max(35).default("en"),
    question: z.string().trim().min(3).max(1_000),
  })
  .strict();

export const assistantConfidenceSchema = z
  .object({
    explanation: shortTextSchema,
    level: z.enum(["high", "medium", "low", "unknown"]),
  })
  .strict();

export const assistantSourceSchema = z
  .object({
    freshness: z.enum(["fresh", "stale", "unknown"]),
    official: z.boolean(),
    retrievedAt: z.string().datetime({ offset: true }),
    sourceId: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(240),
    url: z.string().url(),
    validUntil: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const assistantClaimSchema = z
  .object({
    claimId: z.string().trim().min(1).max(128),
    confidence: assistantConfidenceSchema,
    sourceIds: z.array(z.string().trim().min(1).max(128)).min(1).max(20),
    text: z.string().trim().min(1).max(1_000),
  })
  .strict();

const assistantActionBaseSchema = z.object({
  sourceIds: z.array(z.string().trim().min(1).max(128)).min(1).max(20),
  summary: shortTextSchema,
});

export const assistantActionPayloadSchema = z.discriminatedUnion("kind", [
  assistantActionBaseSchema
    .extend({
      itineraryDayId: identifierSchema,
      itemType: z.enum(["activity", "food", "lodging", "transport", "note"]).default("activity"),
      kind: z.literal("add_place"),
      notes: z.string().trim().max(1_000).nullable().default(null),
      placeId: identifierSchema,
    })
    .strict(),
  assistantActionBaseSchema
    .extend({
      itemId: identifierSchema,
      kind: z.literal("replace_item"),
      placeId: identifierSchema,
    })
    .strict(),
  assistantActionBaseSchema
    .extend({ itemId: identifierSchema, kind: z.literal("remove_item") })
    .strict(),
  assistantActionBaseSchema
    .extend({
      itineraryDayId: identifierSchema,
      itemId: identifierSchema,
      kind: z.literal("reorder_item"),
      orderIndex: z.number().int().min(0).max(9_999),
    })
    .strict(),
  assistantActionBaseSchema
    .extend({
      itemId: identifierSchema,
      kind: z.literal("save_note"),
      note: z.string().trim().min(1).max(1_000),
    })
    .strict(),
]);

export const assistantActionStatusSchema = z.enum([
  "pending",
  "confirmed",
  "applied",
  "cancelled",
  "failed",
]);

export const assistantActionPreviewSchema = z
  .object({
    actionId: identifierSchema,
    expectedTripRevision: z.number().int().min(1),
    expiresAt: z.string().datetime({ offset: true }),
    payload: assistantActionPayloadSchema,
    status: assistantActionStatusSchema,
    tripId: identifierSchema,
  })
  .strict();

export const assistantAnswerSchema = z
  .object({
    actions: z.array(assistantActionPreviewSchema).max(10),
    answer: z.string().trim().min(1).max(8_000),
    claims: z.array(assistantClaimSchema).max(50),
    evidence: z
      .object({
        gaps: z.array(shortTextSchema).max(20),
        status: z.enum(["complete", "partial", "empty"]),
      })
      .strict(),
    safety: z
      .object({
        classification: z.enum(["general", "high_stakes", "refusal"]),
        disclaimer: shortTextSchema.nullable(),
        explanation: shortTextSchema,
        officialSourceRequired: z.boolean(),
      })
      .strict(),
    sources: z.array(assistantSourceSchema).max(100),
    status: z.enum(["answered", "partial", "insufficient_evidence", "refused"]),
    uncertainty: z
      .object({ level: z.enum(["low", "medium", "high"]), explanation: shortTextSchema })
      .strict(),
  })
  .strict()
  .superRefine((answer, context) => {
    const sourceIds = new Set(answer.sources.map((source) => source.sourceId));
    answer.claims.forEach((claim, claimIndex) => {
      claim.sourceIds.forEach((sourceId, sourceIndex) => {
        if (!sourceIds.has(sourceId)) {
          context.addIssue({
            code: "custom",
            message: "Assistant claim references an unknown source.",
            path: ["claims", claimIndex, "sourceIds", sourceIndex],
          });
        }
      });
    });
    if (
      answer.safety.officialSourceRequired &&
      (answer.status === "answered" || answer.status === "partial") &&
      !answer.sources.some((source) => source.official)
    ) {
      context.addIssue({
        code: "custom",
        message: "High-stakes answers require an official source.",
        path: ["sources"],
      });
    }
    if (
      (answer.status === "insufficient_evidence" || answer.status === "refused") &&
      (answer.claims.length > 0 || answer.actions.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Unavailable or refused answers cannot include claims or actions.",
        path: ["status"],
      });
    }
  });

export const assistantQueryResponseSchema = z.object({
  data: assistantAnswerSchema,
  meta: assistantMetaSchema,
});

export const assistantActionMutationSchema = z
  .object({
    actionId: identifierSchema,
    status: z.enum(["applied", "cancelled"]),
    tripId: identifierSchema,
    tripRevision: z.number().int().min(1).nullable(),
  })
  .strict();

export const assistantActionMutationResponseSchema = z.object({
  data: assistantActionMutationSchema,
  meta: assistantMetaSchema,
});

export type AssistantContext = z.infer<typeof assistantContextSchema>;
export type AssistantQueryInput = z.infer<typeof assistantQueryInputSchema>;
export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;
export type AssistantActionPayload = z.infer<typeof assistantActionPayloadSchema>;
export type AssistantActionPreview = z.infer<typeof assistantActionPreviewSchema>;
export type AssistantActionStatus = z.infer<typeof assistantActionStatusSchema>;
export type AssistantQueryResponse = z.infer<typeof assistantQueryResponseSchema>;
export type AssistantActionMutation = z.infer<typeof assistantActionMutationSchema>;
export type AssistantActionMutationResponse = z.infer<typeof assistantActionMutationResponseSchema>;
