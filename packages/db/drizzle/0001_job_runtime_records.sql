CREATE TABLE "application_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload_version" integer NOT NULL,
	"subject_id" text NOT NULL,
	"requested_by_kind" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload_json" jsonb NOT NULL,
	"result_json" jsonb,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"not_before" timestamp (3) with time zone,
	"started_at" timestamp (3) with time zone,
	"completed_at" timestamp (3) with time zone,
	"error_code" text,
	"error_summary" text,
	"release_sha" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_jobs_type_version_chk" CHECK ("application_jobs"."type" ~ '^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$'),
	CONSTRAINT "application_jobs_payload_version_positive_chk" CHECK ("application_jobs"."payload_version" > 0),
	CONSTRAINT "application_jobs_payload_object_chk" CHECK (jsonb_typeof("application_jobs"."payload_json") = 'object'),
	CONSTRAINT "application_jobs_result_object_chk" CHECK ("application_jobs"."result_json" is null or jsonb_typeof("application_jobs"."result_json") = 'object'),
	CONSTRAINT "application_jobs_attempt_nonnegative_chk" CHECK ("application_jobs"."attempt" >= 0),
	CONSTRAINT "application_jobs_max_attempts_positive_chk" CHECK ("application_jobs"."max_attempts" > 0),
	CONSTRAINT "application_jobs_attempt_limit_chk" CHECK ("application_jobs"."attempt" <= "application_jobs"."max_attempts"),
	CONSTRAINT "application_jobs_requested_by_kind_chk" CHECK ("application_jobs"."requested_by_kind" in ('user', 'system', 'operator')),
	CONSTRAINT "application_jobs_status_chk" CHECK ("application_jobs"."status" in ('queued', 'running', 'retrying', 'succeeded', 'cancelled', 'dead_lettered', 'discarded'))
);

CREATE TABLE "job_operator_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"replacement_job_id" uuid,
	"operator_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_operator_actions_action_chk" CHECK ("job_operator_actions"."action" in ('redrive', 'discard')),
	CONSTRAINT "job_operator_actions_reason_length_chk" CHECK (char_length("job_operator_actions"."reason") between 1 and 500)
);

ALTER TABLE "job_operator_actions" ADD CONSTRAINT "job_operator_actions_job_id_application_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."application_jobs"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "job_operator_actions" ADD CONSTRAINT "job_operator_actions_replacement_job_id_application_jobs_id_fk" FOREIGN KEY ("replacement_job_id") REFERENCES "public"."application_jobs"("id") ON DELETE set null ON UPDATE no action;
CREATE UNIQUE INDEX "application_jobs_idempotency_key_uidx" ON "application_jobs" USING btree ("idempotency_key");
CREATE INDEX "application_jobs_status_updated_idx" ON "application_jobs" USING btree ("status","updated_at" DESC NULLS LAST);
CREATE INDEX "application_jobs_subject_created_idx" ON "application_jobs" USING btree ("subject_id","created_at" DESC NULLS LAST);
CREATE INDEX "application_jobs_type_status_idx" ON "application_jobs" USING btree ("type","status");
CREATE INDEX "job_operator_actions_job_created_idx" ON "job_operator_actions" USING btree ("job_id","created_at" DESC NULLS LAST);