import { aiEvaluationCaseResults, aiEvaluationRuns, type Database } from "@roavia/db";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  aiEvaluationReportSchema,
  compareAiEvaluationReports,
  type AiEvaluationComparison,
  type AiEvaluationReport,
} from "../evaluation.js";

export class AiEvaluationHistoryConflictError extends Error {
  constructor(message = "This AI evaluation run already exists and cannot be overwritten.") {
    super(message);
    this.name = "AiEvaluationHistoryConflictError";
  }
}

export interface AiEvaluationHistoryStore {
  compare(baselineRunId: string, currentRunId: string): Promise<AiEvaluationComparison>;
  get(runId: string): Promise<AiEvaluationReport | null>;
  save(report: AiEvaluationReport): Promise<void>;
}

function postgresErrorCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 5 && candidate && typeof candidate === "object"; depth += 1) {
    if ("code" in candidate && typeof candidate.code === "string") return candidate.code;
    candidate = "cause" in candidate ? candidate.cause : undefined;
  }
  return undefined;
}

function reportFromRows(
  run: typeof aiEvaluationRuns.$inferSelect,
  cases: Array<typeof aiEvaluationCaseResults.$inferSelect>,
): AiEvaluationReport {
  return aiEvaluationReportSchema.parse({
    cases: cases.map((result) => ({
      caseId: result.caseId,
      caseVersion: result.caseVersion,
      dimensions: result.dimensions,
      durationMs: result.durationMs,
      estimatedCostMicros: result.estimatedCostMicros,
      failureCodes: result.failureCodes,
      passed: result.passed,
      score: result.score,
      scores: result.scores,
    })),
    completedAt: run.completedAt.toISOString(),
    model: run.model,
    passed: run.passed,
    promptVersion: run.promptVersion,
    provider: run.provider,
    runId: run.id,
    startedAt: run.startedAt.toISOString(),
    suiteId: run.suiteId,
    suiteVersion: run.suiteVersion,
    summary: run.summary,
    thresholdViolations: run.thresholdViolations,
    thresholds: run.thresholds,
  });
}

/** Append-only evaluation history; save never updates or replaces an existing run. */
export class PostgresAiEvaluationHistoryStore implements AiEvaluationHistoryStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async save(rawReport: AiEvaluationReport): Promise<void> {
    const report = aiEvaluationReportSchema.parse(rawReport);
    try {
      await this.db.transaction(async (transaction) => {
        await transaction.insert(aiEvaluationRuns).values({
          completedAt: new Date(report.completedAt),
          id: report.runId,
          model: report.model,
          overallScore: report.summary.overallScore,
          p95LatencyMs: report.summary.p95LatencyMs,
          passed: report.passed,
          promptVersion: report.promptVersion,
          provider: report.provider,
          startedAt: new Date(report.startedAt),
          suiteId: report.suiteId,
          suiteVersion: report.suiteVersion,
          summary: report.summary,
          thresholdViolations: report.thresholdViolations,
          thresholds: report.thresholds,
          totalEstimatedCostMicros: report.summary.totalEstimatedCostMicros,
        });
        await transaction.insert(aiEvaluationCaseResults).values(
          report.cases.map((result) => ({
            caseId: result.caseId,
            caseVersion: result.caseVersion,
            dimensions: result.dimensions,
            durationMs: result.durationMs,
            estimatedCostMicros: result.estimatedCostMicros,
            evaluationRunId: report.runId,
            failureCodes: result.failureCodes,
            passed: result.passed,
            score: result.score,
            scores: result.scores,
          })),
        );
      });
    } catch (error) {
      if (postgresErrorCode(error) === "23505") {
        throw new AiEvaluationHistoryConflictError();
      }
      throw error;
    }
  }

  async get(runId: string): Promise<AiEvaluationReport | null> {
    const parsedRunId = z.uuid().parse(runId);
    const [run] = await this.db
      .select()
      .from(aiEvaluationRuns)
      .where(eq(aiEvaluationRuns.id, parsedRunId))
      .limit(1);
    if (!run) return null;
    const cases = await this.db
      .select()
      .from(aiEvaluationCaseResults)
      .where(eq(aiEvaluationCaseResults.evaluationRunId, parsedRunId))
      .orderBy(asc(aiEvaluationCaseResults.caseId));
    return reportFromRows(run, cases);
  }

  async compare(baselineRunId: string, currentRunId: string): Promise<AiEvaluationComparison> {
    const [baseline, current] = await Promise.all([
      this.get(baselineRunId),
      this.get(currentRunId),
    ]);
    if (!baseline || !current) throw new Error("Both AI evaluation runs are required to compare.");
    return compareAiEvaluationReports(baseline, current);
  }
}
