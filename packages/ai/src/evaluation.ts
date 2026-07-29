import { randomUUID } from "node:crypto";

import { z } from "zod";

export const AI_EVALUATION_DIMENSIONS = [
  "feasibility",
  "relevance",
  "grounding",
  "budget",
  "family_accessibility",
  "seasonality",
  "unsupported_claims",
  "repair_quality",
] as const;

export const aiEvaluationDimensionSchema = z.enum(AI_EVALUATION_DIMENSIONS);
export type AiEvaluationDimension = z.infer<typeof aiEvaluationDimensionSchema>;

const identifierSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
const modelIdentifierSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/);
const scoreSchema = z.number().finite().min(0).max(1);
const dimensionScoresSchema = z
  .object({
    budget: scoreSchema,
    family_accessibility: scoreSchema,
    feasibility: scoreSchema,
    grounding: scoreSchema,
    relevance: scoreSchema,
    repair_quality: scoreSchema,
    seasonality: scoreSchema,
    unsupported_claims: scoreSchema,
  })
  .strict();
const partialDimensionScoresSchema = dimensionScoresSchema.partial();

export const aiEvaluationThresholdsSchema = z
  .object({
    maximumEstimatedCostMicros: z.number().int().nonnegative(),
    maximumFailedCases: z.number().int().nonnegative(),
    maximumP95LatencyMs: z.number().int().nonnegative(),
    maximumUnpricedCases: z.number().int().nonnegative(),
    minimumCaseScore: scoreSchema,
    minimumDimensionScores: partialDimensionScoresSchema,
    minimumOverallScore: scoreSchema,
  })
  .strict();
export type AiEvaluationThresholds = z.infer<typeof aiEvaluationThresholdsSchema>;

export const DEFAULT_AI_EVALUATION_THRESHOLDS: AiEvaluationThresholds = {
  maximumEstimatedCostMicros: 100_000,
  maximumFailedCases: 0,
  maximumP95LatencyMs: 30_000,
  maximumUnpricedCases: 0,
  minimumCaseScore: 0.8,
  minimumDimensionScores: Object.fromEntries(
    AI_EVALUATION_DIMENSIONS.map((dimension) => [dimension, 0.8]),
  ) as Record<AiEvaluationDimension, number>,
  minimumOverallScore: 0.85,
};

export const aiEvaluationObservationSchema = z
  .object({
    durationMs: z.number().int().nonnegative(),
    estimatedCostMicros: z.number().int().nonnegative().optional(),
    failureCodes: z.array(identifierSchema).max(50).default([]),
    scores: partialDimensionScoresSchema,
  })
  .strict();
export type AiEvaluationObservation = z.infer<typeof aiEvaluationObservationSchema>;

export interface AiEvaluationCase {
  caseId: string;
  caseVersion: string;
  dimensions: readonly AiEvaluationDimension[];
  evaluate: () => AiEvaluationObservation | Promise<AiEvaluationObservation>;
}

export const aiEvaluationCaseResultSchema = z
  .object({
    caseId: identifierSchema,
    caseVersion: identifierSchema,
    dimensions: z.array(aiEvaluationDimensionSchema).min(1),
    durationMs: z.number().int().nonnegative(),
    estimatedCostMicros: z.number().int().nonnegative().nullable(),
    failureCodes: z.array(identifierSchema).max(50),
    passed: z.boolean(),
    score: scoreSchema,
    scores: partialDimensionScoresSchema,
  })
  .strict();
export type AiEvaluationCaseResult = z.infer<typeof aiEvaluationCaseResultSchema>;

export const aiEvaluationSummarySchema = z
  .object({
    dimensionScores: dimensionScoresSchema,
    failedCaseCount: z.number().int().nonnegative(),
    overallScore: scoreSchema,
    p95LatencyMs: z.number().int().nonnegative(),
    passedCaseCount: z.number().int().nonnegative(),
    totalEstimatedCostMicros: z.number().int().nonnegative(),
    unpricedCaseCount: z.number().int().nonnegative(),
  })
  .strict();
export type AiEvaluationSummary = z.infer<typeof aiEvaluationSummarySchema>;

export const aiEvaluationReportSchema = z
  .object({
    cases: z.array(aiEvaluationCaseResultSchema).min(1),
    completedAt: z.iso.datetime({ offset: true }),
    model: modelIdentifierSchema,
    passed: z.boolean(),
    promptVersion: identifierSchema,
    provider: identifierSchema,
    runId: z.uuid(),
    startedAt: z.iso.datetime({ offset: true }),
    suiteId: identifierSchema,
    suiteVersion: identifierSchema,
    summary: aiEvaluationSummarySchema,
    thresholdViolations: z.array(identifierSchema),
    thresholds: aiEvaluationThresholdsSchema,
  })
  .strict();
export type AiEvaluationReport = z.infer<typeof aiEvaluationReportSchema>;

export interface RunAiEvaluationSuiteInput {
  cases: readonly AiEvaluationCase[];
  clock?: () => Date;
  createRunId?: () => string;
  model: string;
  promptVersion: string;
  provider: string;
  suiteId: string;
  suiteVersion: string;
  thresholds?: AiEvaluationThresholds;
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

function thresholdViolations(
  summary: AiEvaluationSummary,
  thresholds: AiEvaluationThresholds,
): string[] {
  const violations: string[] = [];
  if (summary.overallScore < thresholds.minimumOverallScore) {
    violations.push("overall_score_below_threshold");
  }
  for (const dimension of AI_EVALUATION_DIMENSIONS) {
    const minimum = thresholds.minimumDimensionScores[dimension];
    if (minimum !== undefined && summary.dimensionScores[dimension] < minimum) {
      violations.push(`${dimension}_below_threshold`);
    }
  }
  if (summary.failedCaseCount > thresholds.maximumFailedCases) {
    violations.push("failed_case_limit_exceeded");
  }
  if (summary.unpricedCaseCount > thresholds.maximumUnpricedCases) {
    violations.push("unpriced_case_limit_exceeded");
  }
  if (summary.p95LatencyMs > thresholds.maximumP95LatencyMs) {
    violations.push("p95_latency_limit_exceeded");
  }
  if (summary.totalEstimatedCostMicros > thresholds.maximumEstimatedCostMicros) {
    violations.push("estimated_cost_limit_exceeded");
  }
  return violations;
}

/** Runs deterministic or provider-backed cases and produces one immutable, versioned report. */
export async function runAiEvaluationSuite(
  rawInput: RunAiEvaluationSuiteInput,
): Promise<AiEvaluationReport> {
  const identifiers = z
    .object({
      model: modelIdentifierSchema,
      promptVersion: identifierSchema,
      provider: identifierSchema,
      suiteId: identifierSchema,
      suiteVersion: identifierSchema,
    })
    .strict()
    .parse({
      model: rawInput.model,
      promptVersion: rawInput.promptVersion,
      provider: rawInput.provider,
      suiteId: rawInput.suiteId,
      suiteVersion: rawInput.suiteVersion,
    });
  const thresholds = aiEvaluationThresholdsSchema.parse(
    rawInput.thresholds ?? DEFAULT_AI_EVALUATION_THRESHOLDS,
  );
  if (rawInput.cases.length === 0)
    throw new Error("AI evaluation suites require at least one case.");
  const clock = rawInput.clock ?? (() => new Date());
  const runId = z.uuid().parse((rawInput.createRunId ?? randomUUID)());
  const startedAt = clock();
  const caseIds = new Set<string>();
  const cases: AiEvaluationCaseResult[] = [];

  for (const rawCase of rawInput.cases) {
    const definition = z
      .object({
        caseId: identifierSchema,
        caseVersion: identifierSchema,
        dimensions: z.array(aiEvaluationDimensionSchema).min(1),
      })
      .strict()
      .parse({
        caseId: rawCase.caseId,
        caseVersion: rawCase.caseVersion,
        dimensions: [...new Set(rawCase.dimensions)],
      });
    if (caseIds.has(definition.caseId)) {
      throw new Error(`Duplicate AI evaluation case: ${definition.caseId}`);
    }
    caseIds.add(definition.caseId);
    const observation = aiEvaluationObservationSchema.parse(await rawCase.evaluate());
    const missing = definition.dimensions.filter(
      (dimension) => observation.scores[dimension] === undefined,
    );
    const undeclared = Object.keys(observation.scores).filter(
      (dimension) => !definition.dimensions.includes(dimension as AiEvaluationDimension),
    );
    if (missing.length > 0 || undeclared.length > 0) {
      throw new Error(
        `Evaluation case ${definition.caseId} has mismatched dimensions: missing=${missing.join(",") || "none"}; undeclared=${undeclared.join(",") || "none"}.`,
      );
    }
    const score = roundScore(
      average(definition.dimensions.map((dimension) => observation.scores[dimension] as number)),
    );
    cases.push(
      aiEvaluationCaseResultSchema.parse({
        ...definition,
        durationMs: observation.durationMs,
        estimatedCostMicros: observation.estimatedCostMicros ?? null,
        failureCodes: observation.failureCodes,
        passed: score >= thresholds.minimumCaseScore && observation.failureCodes.length === 0,
        score,
        scores: observation.scores,
      }),
    );
  }

  const dimensionScores = Object.fromEntries(
    AI_EVALUATION_DIMENSIONS.map((dimension) => [
      dimension,
      roundScore(
        average(
          cases.flatMap((result) =>
            result.scores[dimension] === undefined ? [] : [result.scores[dimension]],
          ),
        ),
      ),
    ]),
  ) as Record<AiEvaluationDimension, number>;
  const summary = aiEvaluationSummarySchema.parse({
    dimensionScores,
    failedCaseCount: cases.filter((result) => !result.passed).length,
    overallScore: roundScore(average(Object.values(dimensionScores))),
    p95LatencyMs: percentile95(cases.map(({ durationMs }) => durationMs)),
    passedCaseCount: cases.filter((result) => result.passed).length,
    totalEstimatedCostMicros: cases.reduce(
      (total, result) => total + (result.estimatedCostMicros ?? 0),
      0,
    ),
    unpricedCaseCount: cases.filter((result) => result.estimatedCostMicros === null).length,
  });
  const violations = thresholdViolations(summary, thresholds);
  return aiEvaluationReportSchema.parse({
    ...identifiers,
    cases,
    completedAt: clock().toISOString(),
    passed: violations.length === 0,
    runId,
    startedAt: startedAt.toISOString(),
    summary,
    thresholdViolations: violations,
    thresholds,
  });
}

export class AiEvaluationThresholdError extends Error {
  readonly violations: readonly string[];

  constructor(report: AiEvaluationReport) {
    super(`AI evaluation release gate failed: ${report.thresholdViolations.join(", ")}.`);
    this.name = "AiEvaluationThresholdError";
    this.violations = report.thresholdViolations;
  }
}

export function assertAiEvaluationThresholds(report: AiEvaluationReport): void {
  const parsed = aiEvaluationReportSchema.parse(report);
  if (!parsed.passed) throw new AiEvaluationThresholdError(parsed);
}

export const aiEvaluationComparisonSchema = z
  .object({
    baseline: z.object({
      model: modelIdentifierSchema,
      promptVersion: identifierSchema,
      runId: z.uuid(),
    }),
    caseScoreDeltas: z.record(identifierSchema, z.number().finite()),
    current: z.object({
      model: modelIdentifierSchema,
      promptVersion: identifierSchema,
      runId: z.uuid(),
    }),
    dimensionScoreDeltas: z.record(aiEvaluationDimensionSchema, z.number().finite()),
    overallScoreDelta: z.number().finite(),
    p95LatencyDeltaMs: z.number().int(),
    totalEstimatedCostDeltaMicros: z.number().int(),
  })
  .strict();
export type AiEvaluationComparison = z.infer<typeof aiEvaluationComparisonSchema>;

/** Compares two immutable reports while preserving both model and prompt identities. */
export function compareAiEvaluationReports(
  baseline: AiEvaluationReport,
  current: AiEvaluationReport,
): AiEvaluationComparison {
  const parsedBaseline = aiEvaluationReportSchema.parse(baseline);
  const parsedCurrent = aiEvaluationReportSchema.parse(current);
  if (
    parsedBaseline.suiteId !== parsedCurrent.suiteId ||
    parsedBaseline.suiteVersion !== parsedCurrent.suiteVersion
  ) {
    throw new Error("AI evaluation comparisons require the same suite ID and version.");
  }
  const baselineCases = new Map(parsedBaseline.cases.map((result) => [result.caseId, result]));
  return aiEvaluationComparisonSchema.parse({
    baseline: {
      model: parsedBaseline.model,
      promptVersion: parsedBaseline.promptVersion,
      runId: parsedBaseline.runId,
    },
    caseScoreDeltas: Object.fromEntries(
      parsedCurrent.cases.flatMap((result) => {
        const previous = baselineCases.get(result.caseId);
        return previous ? [[result.caseId, roundScore(result.score - previous.score)]] : [];
      }),
    ),
    current: {
      model: parsedCurrent.model,
      promptVersion: parsedCurrent.promptVersion,
      runId: parsedCurrent.runId,
    },
    dimensionScoreDeltas: Object.fromEntries(
      AI_EVALUATION_DIMENSIONS.map((dimension) => [
        dimension,
        roundScore(
          parsedCurrent.summary.dimensionScores[dimension] -
            parsedBaseline.summary.dimensionScores[dimension],
        ),
      ]),
    ),
    overallScoreDelta: roundScore(
      parsedCurrent.summary.overallScore - parsedBaseline.summary.overallScore,
    ),
    p95LatencyDeltaMs: parsedCurrent.summary.p95LatencyMs - parsedBaseline.summary.p95LatencyMs,
    totalEstimatedCostDeltaMicros:
      parsedCurrent.summary.totalEstimatedCostMicros -
      parsedBaseline.summary.totalEstimatedCostMicros,
  });
}
