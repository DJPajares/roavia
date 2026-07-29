import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./client.js";
import { aiTelemetryEvents } from "./schema.js";

const RAW_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const identifierSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/);
const modelIdentifierSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/);
const operationSchema = z.enum(["assistant", "itinerary", "trip_intent"]);
const tokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export const aiGenerationTelemetryInputSchema = z
  .object({
    cost: z
      .object({ amountMicros: z.number().int().nonnegative(), currency: z.literal("USD") })
      .strict()
      .optional(),
    durationMs: z.number().int().nonnegative(),
    errorCode: identifierSchema.optional(),
    finishReason: z
      .enum(["stop", "length", "content-filter", "tool-calls", "error", "other"])
      .optional(),
    generationId: z.uuid(),
    model: modelIdentifierSchema,
    operation: operationSchema,
    outcome: z.enum(["success", "error"]),
    promptVersion: identifierSchema,
    provider: identifierSchema,
    requestId: identifierSchema.optional(),
    safety: z
      .object({ blocked: z.boolean(), category: identifierSchema.optional() })
      .strict()
      .optional(),
    timestamp: z.iso.datetime({ offset: true }),
    usage: tokenUsageSchema.optional(),
  })
  .strict();
export type AiGenerationTelemetryInput = z.infer<typeof aiGenerationTelemetryInputSchema>;

export const aiQualityTelemetryInputSchema = z
  .object({
    correlationId: identifierSchema.optional(),
    generationId: z.uuid(),
    issueCodes: z.array(identifierSchema).max(50),
    model: modelIdentifierSchema,
    outcome: z.enum(["accepted", "rejected", "error"]),
    promptVersion: identifierSchema,
    provider: identifierSchema,
    repairCount: z.number().int().min(0).max(1),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .strict();
export type AiQualityTelemetryInput = z.infer<typeof aiQualityTelemetryInputSchema>;

export const aiAssistantActionTelemetryInputSchema = z
  .object({
    actionCount: z.number().int().positive().max(20),
    correlationId: identifierSchema,
    outcome: z.enum(["offered", "confirmed", "cancelled", "failed"]),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .strict();
export type AiAssistantActionTelemetryInput = z.infer<typeof aiAssistantActionTelemetryInputSchema>;

export interface AiTelemetryAggregate {
  acceptedActionCount: number;
  acceptanceRate: number | null;
  averageLatencyMs: number;
  cancelledActionCount: number;
  errorCount: number;
  failedActionCount: number;
  generationCount: number;
  inputTokens: number;
  operation: z.infer<typeof operationSchema>;
  offeredActionCount: number;
  outputTokens: number;
  p95LatencyMs: number;
  repairCount: number;
  successCount: number;
  totalEstimatedCostMicros: number;
  totalTokens: number;
  unpricedGenerationCount: number;
  validationFailureCount: number;
}

export interface AiTelemetryAggregateQuery {
  from: Date;
  operation?: z.infer<typeof operationSchema>;
  to: Date;
}

export interface AiTelemetryRepository {
  aggregate(query: AiTelemetryAggregateQuery): Promise<AiTelemetryAggregate[]>;
  pruneExpired(now?: Date): Promise<number>;
  recordAssistantAction(input: AiAssistantActionTelemetryInput): Promise<void>;
  recordGeneration(input: AiGenerationTelemetryInput): Promise<void>;
  recordQuality(input: AiQualityTelemetryInput): Promise<void>;
}

function expiresAt(timestamp: Date): Date {
  return new Date(timestamp.getTime() + RAW_RETENTION_MS);
}

function number(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

/** Internal-only append-only AI telemetry. Runtime validation rejects content-bearing fields. */
export function createAiTelemetryRepository(db: Database): AiTelemetryRepository {
  return {
    async recordGeneration(rawInput) {
      const input = aiGenerationTelemetryInputSchema.parse(rawInput);
      const timestamp = new Date(input.timestamp);
      await db
        .insert(aiTelemetryEvents)
        .values({
          correlationId: input.requestId,
          costAmountMicros: input.cost?.amountMicros,
          costCurrency: input.cost?.currency,
          createdAt: timestamp,
          durationMs: input.durationMs,
          errorCode: input.errorCode,
          eventType: "generation",
          expiresAt: expiresAt(timestamp),
          generationId: input.generationId,
          inputTokens: input.usage?.inputTokens,
          issueCodes: [],
          model: input.model,
          operation: input.operation,
          outcome: input.outcome,
          outputTokens: input.usage?.outputTokens,
          promptVersion: input.promptVersion,
          provider: input.provider,
          safetyBlocked: input.safety?.blocked,
          safetyCategory: input.safety?.category,
          totalTokens: input.usage?.totalTokens,
        })
        .onConflictDoNothing({
          target: aiTelemetryEvents.generationId,
          where: sql`${aiTelemetryEvents.eventType} = 'generation'`,
        });
    },

    async recordQuality(rawInput) {
      const input = aiQualityTelemetryInputSchema.parse(rawInput);
      const timestamp = new Date(input.timestamp);
      await db
        .insert(aiTelemetryEvents)
        .values({
          correlationId: input.correlationId,
          createdAt: timestamp,
          eventType: "quality",
          expiresAt: expiresAt(timestamp),
          generationId: input.generationId,
          issueCodes: input.issueCodes,
          model: input.model,
          operation: "itinerary",
          outcome: input.outcome,
          promptVersion: input.promptVersion,
          provider: input.provider,
          repairCount: input.repairCount,
          validationFailureCount: input.issueCodes.length,
        })
        .onConflictDoNothing({
          target: aiTelemetryEvents.generationId,
          where: sql`${aiTelemetryEvents.eventType} = 'quality'`,
        });
    },

    async recordAssistantAction(rawInput) {
      const input = aiAssistantActionTelemetryInputSchema.parse(rawInput);
      const timestamp = new Date(input.timestamp);
      await db.insert(aiTelemetryEvents).values({
        actionCount: input.actionCount,
        correlationId: input.correlationId,
        createdAt: timestamp,
        eventType: "user_action",
        expiresAt: expiresAt(timestamp),
        issueCodes: [],
        operation: "assistant",
        outcome: input.outcome,
      });
    },

    async aggregate(rawQuery) {
      const query = z
        .object({
          from: z.date(),
          operation: operationSchema.optional(),
          to: z.date(),
        })
        .strict()
        .parse(rawQuery);
      if (query.to <= query.from) throw new RangeError("Telemetry aggregation requires to > from.");
      const where = and(
        gte(aiTelemetryEvents.createdAt, query.from),
        lt(aiTelemetryEvents.createdAt, query.to),
        query.operation ? eq(aiTelemetryEvents.operation, query.operation) : undefined,
      );
      const rows = await db
        .select({
          acceptedActionCount: sql<number>`coalesce(sum(${aiTelemetryEvents.actionCount}) filter (where ${aiTelemetryEvents.eventType} = 'user_action' and ${aiTelemetryEvents.outcome} = 'confirmed'), 0)`,
          averageLatencyMs: sql<number>`coalesce(round(avg(${aiTelemetryEvents.durationMs}) filter (where ${aiTelemetryEvents.eventType} = 'generation')), 0)`,
          cancelledActionCount: sql<number>`coalesce(sum(${aiTelemetryEvents.actionCount}) filter (where ${aiTelemetryEvents.eventType} = 'user_action' and ${aiTelemetryEvents.outcome} = 'cancelled'), 0)`,
          errorCount: sql<number>`count(*) filter (where ${aiTelemetryEvents.eventType} = 'generation' and ${aiTelemetryEvents.outcome} = 'error')`,
          failedActionCount: sql<number>`coalesce(sum(${aiTelemetryEvents.actionCount}) filter (where ${aiTelemetryEvents.eventType} = 'user_action' and ${aiTelemetryEvents.outcome} = 'failed'), 0)`,
          generationCount: sql<number>`count(*) filter (where ${aiTelemetryEvents.eventType} = 'generation')`,
          inputTokens: sql<number>`coalesce(sum(${aiTelemetryEvents.inputTokens}) filter (where ${aiTelemetryEvents.eventType} = 'generation'), 0)`,
          offeredActionCount: sql<number>`coalesce(sum(${aiTelemetryEvents.actionCount}) filter (where ${aiTelemetryEvents.eventType} = 'user_action' and ${aiTelemetryEvents.outcome} = 'offered'), 0)`,
          operation: aiTelemetryEvents.operation,
          outputTokens: sql<number>`coalesce(sum(${aiTelemetryEvents.outputTokens}) filter (where ${aiTelemetryEvents.eventType} = 'generation'), 0)`,
          p95LatencyMs: sql<number>`coalesce(round(percentile_cont(0.95) within group (order by ${aiTelemetryEvents.durationMs}) filter (where ${aiTelemetryEvents.eventType} = 'generation')), 0)`,
          repairCount: sql<number>`coalesce(sum(${aiTelemetryEvents.repairCount}), 0)`,
          successCount: sql<number>`count(*) filter (where ${aiTelemetryEvents.eventType} = 'generation' and ${aiTelemetryEvents.outcome} = 'success')`,
          totalEstimatedCostMicros: sql<number>`coalesce(sum(${aiTelemetryEvents.costAmountMicros}) filter (where ${aiTelemetryEvents.eventType} = 'generation'), 0)`,
          totalTokens: sql<number>`coalesce(sum(${aiTelemetryEvents.totalTokens}) filter (where ${aiTelemetryEvents.eventType} = 'generation'), 0)`,
          unpricedGenerationCount: sql<number>`count(*) filter (where ${aiTelemetryEvents.eventType} = 'generation' and ${aiTelemetryEvents.costAmountMicros} is null)`,
          validationFailureCount: sql<number>`coalesce(sum(${aiTelemetryEvents.validationFailureCount}), 0)`,
        })
        .from(aiTelemetryEvents)
        .where(where)
        .groupBy(aiTelemetryEvents.operation)
        .orderBy(aiTelemetryEvents.operation);
      return rows.map((row) => {
        const offeredActionCount = number(row.offeredActionCount);
        const acceptedActionCount = number(row.acceptedActionCount);
        return {
          acceptedActionCount,
          acceptanceRate:
            offeredActionCount === 0
              ? null
              : Math.round((acceptedActionCount / offeredActionCount) * 10_000) / 10_000,
          averageLatencyMs: number(row.averageLatencyMs),
          cancelledActionCount: number(row.cancelledActionCount),
          errorCount: number(row.errorCount),
          failedActionCount: number(row.failedActionCount),
          generationCount: number(row.generationCount),
          inputTokens: number(row.inputTokens),
          offeredActionCount,
          operation: row.operation,
          outputTokens: number(row.outputTokens),
          p95LatencyMs: number(row.p95LatencyMs),
          repairCount: number(row.repairCount),
          successCount: number(row.successCount),
          totalEstimatedCostMicros: number(row.totalEstimatedCostMicros),
          totalTokens: number(row.totalTokens),
          unpricedGenerationCount: number(row.unpricedGenerationCount),
          validationFailureCount: number(row.validationFailureCount),
        };
      });
    },

    async pruneExpired(now = new Date()) {
      const deleted = await db
        .delete(aiTelemetryEvents)
        .where(lte(aiTelemetryEvents.expiresAt, now))
        .returning({ id: aiTelemetryEvents.id });
      return deleted.length;
    },
  };
}
