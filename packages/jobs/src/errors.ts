export type JobFailureKind = "cancelled" | "permanent" | "transient";

export class JobExecutionError extends Error {
  readonly code: string;
  readonly kind: JobFailureKind;

  constructor(kind: JobFailureKind, code: string, message: string) {
    super(message);
    this.name = "JobExecutionError";
    this.kind = kind;
    this.code = code;
  }
}

export function cancelledJob(message = "Job execution was cancelled.") {
  return new JobExecutionError("cancelled", "cancelled", message);
}

export function permanentJobFailure(code: string, message: string) {
  return new JobExecutionError("permanent", code, message);
}

export function transientJobFailure(code: string, message: string) {
  return new JobExecutionError("transient", code, message);
}
