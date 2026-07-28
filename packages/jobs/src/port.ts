import type {
  DeadLetterRecord,
  EnqueueJobInput,
  JobDefinition,
  JobRecord,
  ListJobsInput,
  OperatorAction,
} from "./contracts.js";

export interface JobRuntime {
  cancel(jobId: string): Promise<JobRecord>;
  discard(deadLetterJobId: string, operatorId: string, reason: string): Promise<OperatorAction>;
  enqueue(input: EnqueueJobInput): Promise<JobRecord>;
  get(jobId: string): Promise<JobRecord | undefined>;
  listJobs(input?: ListJobsInput): Promise<JobRecord[]>;
  listDeadLetters(): Promise<DeadLetterRecord[]>;
  redrive(deadLetterJobId: string, operatorId: string, reason: string): Promise<JobRecord>;
  register(definition: JobDefinition): Promise<void> | void;
  shutdown(): Promise<void>;
}
