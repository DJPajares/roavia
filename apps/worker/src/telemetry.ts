import type { JobRuntime, JobTelemetry } from "@roavia/jobs";
import type { AccountLifecycleRepository } from "@roavia/db";
import type { RuntimeObservability } from "@roavia/observability";

export function createWorkerJobTelemetry(observability: RuntimeObservability) {
  return (event: JobTelemetry) => observability.recordJob(event);
}

export function startJobHealthMonitor(
  runtime: Pick<JobRuntime, "listDeadLetters" | "listJobs">,
  observability: RuntimeObservability,
  intervalMs = 30_000,
) {
  let stopped = false;
  const sample = async () => {
    try {
      const [jobs, deadLetters] = await Promise.all([
        runtime.listJobs({ limit: 500 }),
        runtime.listDeadLetters(),
      ]);
      if (stopped) return;
      observability.recordJobHealth(
        jobs.map((job) => ({
          availableAt: job.availableAt,
          completedAt: job.completedAt,
          status: job.status,
          type: job.envelope.type,
        })),
        deadLetters.map((job) => ({
          availableAt: job.availableAt,
          completedAt: job.completedAt,
          status: job.status,
          type: job.envelope.type,
        })),
      );
    } catch {
      observability.logger.log({
        errorCode: "job_health_sample_failed",
        event: "job_health_sample_failed",
        level: "warn",
        operation: "jobs.health",
        outcome: "error",
      });
    }
  };
  void sample();
  const timer = setInterval(() => void sample(), intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function startAccountRetentionMonitor(
  repository: Pick<AccountLifecycleRepository, "pruneExpired">,
  observability: RuntimeObservability,
  intervalMs = 15 * 60 * 1_000,
) {
  let stopped = false;
  const prune = async () => {
    try {
      const result = await repository.pruneExpired();
      if (stopped) return;
      observability.logger.log({
        actionCount: result.audits + result.exports + result.receipts + result.tombstones,
        event: "account_retention_pruned",
        level: "info",
        operation: "account.retention",
        outcome: "success",
      });
    } catch {
      observability.logger.log({
        errorCode: "account_retention_prune_failed",
        event: "account_retention_prune_failed",
        level: "error",
        operation: "account.retention",
        outcome: "error",
      });
    }
  };
  void prune();
  const timer = setInterval(() => void prune(), intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
