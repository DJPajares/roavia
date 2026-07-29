CREATE TABLE "ai_evaluation_case_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"case_id" text NOT NULL,
	"case_version" text NOT NULL,
	"dimensions_json" jsonb NOT NULL,
	"scores_json" jsonb NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"passed" boolean NOT NULL,
	"failure_codes_json" jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"estimated_cost_micros" bigint,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_evaluation_case_results_run_case_unique" UNIQUE("evaluation_run_id","case_id"),
	CONSTRAINT "ai_evaluation_case_results_identifier_chk" CHECK ("ai_evaluation_case_results"."case_id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
        and "ai_evaluation_case_results"."case_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
	CONSTRAINT "ai_evaluation_case_results_score_chk" CHECK ("ai_evaluation_case_results"."score" between 0 and 1),
	CONSTRAINT "ai_evaluation_case_results_metrics_nonnegative_chk" CHECK ("ai_evaluation_case_results"."duration_ms" >= 0 and ("ai_evaluation_case_results"."estimated_cost_micros" is null or "ai_evaluation_case_results"."estimated_cost_micros" >= 0)),
	CONSTRAINT "ai_evaluation_case_results_json_shape_chk" CHECK (jsonb_typeof("ai_evaluation_case_results"."dimensions_json") = 'array'
        and jsonb_array_length("ai_evaluation_case_results"."dimensions_json") > 0
        and jsonb_typeof("ai_evaluation_case_results"."scores_json") = 'object'
        and jsonb_typeof("ai_evaluation_case_results"."failure_codes_json") = 'array')
);

CREATE TABLE "ai_evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" text NOT NULL,
	"suite_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"passed" boolean NOT NULL,
	"overall_score" numeric(5, 4) NOT NULL,
	"p95_latency_ms" integer NOT NULL,
	"total_estimated_cost_micros" bigint NOT NULL,
	"summary_json" jsonb NOT NULL,
	"thresholds_json" jsonb NOT NULL,
	"threshold_violations_json" jsonb NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_evaluation_runs_identifier_chk" CHECK ("ai_evaluation_runs"."suite_id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
        and "ai_evaluation_runs"."suite_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
        and "ai_evaluation_runs"."prompt_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
        and "ai_evaluation_runs"."provider" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
        and char_length("ai_evaluation_runs"."model") between 1 and 200),
	CONSTRAINT "ai_evaluation_runs_score_chk" CHECK ("ai_evaluation_runs"."overall_score" between 0 and 1),
	CONSTRAINT "ai_evaluation_runs_metrics_nonnegative_chk" CHECK ("ai_evaluation_runs"."p95_latency_ms" >= 0 and "ai_evaluation_runs"."total_estimated_cost_micros" >= 0),
	CONSTRAINT "ai_evaluation_runs_json_shape_chk" CHECK (jsonb_typeof("ai_evaluation_runs"."summary_json") = 'object'
        and jsonb_typeof("ai_evaluation_runs"."thresholds_json") = 'object'
        and jsonb_typeof("ai_evaluation_runs"."threshold_violations_json") = 'array'),
	CONSTRAINT "ai_evaluation_runs_time_order_chk" CHECK ("ai_evaluation_runs"."completed_at" >= "ai_evaluation_runs"."started_at" and "ai_evaluation_runs"."created_at" >= "ai_evaluation_runs"."started_at")
);

CREATE TABLE "ai_telemetry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid,
	"correlation_id" text,
	"event_type" text NOT NULL,
	"operation" text NOT NULL,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"outcome" text NOT NULL,
	"error_code" text,
	"duration_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_amount_micros" bigint,
	"cost_currency" text,
	"safety_blocked" boolean,
	"safety_category" text,
	"validation_failure_count" integer DEFAULT 0 NOT NULL,
	"repair_count" integer DEFAULT 0 NOT NULL,
	"action_count" integer DEFAULT 0 NOT NULL,
	"issue_codes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp (3) with time zone DEFAULT now() + interval '90 days' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_telemetry_event_type_chk" CHECK ("ai_telemetry_events"."event_type" in ('generation', 'quality', 'user_action')),
	CONSTRAINT "ai_telemetry_operation_chk" CHECK ("ai_telemetry_events"."operation" in ('assistant', 'itinerary', 'trip_intent')),
	CONSTRAINT "ai_telemetry_outcome_chk" CHECK ("ai_telemetry_events"."outcome" in ('success', 'error', 'accepted', 'rejected', 'offered', 'confirmed', 'cancelled', 'failed')),
	CONSTRAINT "ai_telemetry_identifier_length_chk" CHECK (("ai_telemetry_events"."correlation_id" is null or char_length("ai_telemetry_events"."correlation_id") between 1 and 100)
        and ("ai_telemetry_events"."provider" is null or char_length("ai_telemetry_events"."provider") between 1 and 100)
        and ("ai_telemetry_events"."model" is null or char_length("ai_telemetry_events"."model") between 1 and 200)
        and ("ai_telemetry_events"."prompt_version" is null or char_length("ai_telemetry_events"."prompt_version") between 1 and 100)
        and ("ai_telemetry_events"."error_code" is null or char_length("ai_telemetry_events"."error_code") between 1 and 100)),
	CONSTRAINT "ai_telemetry_counts_nonnegative_chk" CHECK (("ai_telemetry_events"."duration_ms" is null or "ai_telemetry_events"."duration_ms" >= 0)
        and ("ai_telemetry_events"."input_tokens" is null or "ai_telemetry_events"."input_tokens" >= 0)
        and ("ai_telemetry_events"."output_tokens" is null or "ai_telemetry_events"."output_tokens" >= 0)
        and ("ai_telemetry_events"."total_tokens" is null or "ai_telemetry_events"."total_tokens" >= 0)
        and ("ai_telemetry_events"."cost_amount_micros" is null or "ai_telemetry_events"."cost_amount_micros" >= 0)
        and "ai_telemetry_events"."validation_failure_count" >= 0
        and "ai_telemetry_events"."repair_count" >= 0
        and "ai_telemetry_events"."action_count" >= 0),
	CONSTRAINT "ai_telemetry_cost_pair_chk" CHECK (("ai_telemetry_events"."cost_amount_micros" is null) = ("ai_telemetry_events"."cost_currency" is null)),
	CONSTRAINT "ai_telemetry_issue_codes_array_chk" CHECK (jsonb_typeof("ai_telemetry_events"."issue_codes_json") = 'array'),
	CONSTRAINT "ai_telemetry_retention_chk" CHECK ("ai_telemetry_events"."expires_at" > "ai_telemetry_events"."created_at" and "ai_telemetry_events"."expires_at" <= "ai_telemetry_events"."created_at" + interval '90 days'),
	CONSTRAINT "ai_telemetry_event_shape_chk" CHECK (("ai_telemetry_events"."event_type" = 'generation'
          and "ai_telemetry_events"."generation_id" is not null
          and "ai_telemetry_events"."provider" is not null
          and "ai_telemetry_events"."model" is not null
          and "ai_telemetry_events"."prompt_version" is not null
          and "ai_telemetry_events"."duration_ms" is not null
          and "ai_telemetry_events"."outcome" in ('success', 'error')
          and "ai_telemetry_events"."validation_failure_count" = 0
          and "ai_telemetry_events"."repair_count" = 0
          and "ai_telemetry_events"."action_count" = 0)
        or ("ai_telemetry_events"."event_type" = 'quality'
          and "ai_telemetry_events"."generation_id" is not null
          and "ai_telemetry_events"."provider" is not null
          and "ai_telemetry_events"."model" is not null
          and "ai_telemetry_events"."prompt_version" is not null
          and "ai_telemetry_events"."outcome" in ('accepted', 'rejected', 'error')
          and "ai_telemetry_events"."action_count" = 0)
        or ("ai_telemetry_events"."event_type" = 'user_action'
          and "ai_telemetry_events"."correlation_id" is not null
          and "ai_telemetry_events"."operation" = 'assistant'
          and "ai_telemetry_events"."outcome" in ('offered', 'confirmed', 'cancelled', 'failed')
          and "ai_telemetry_events"."action_count" > 0
          and "ai_telemetry_events"."validation_failure_count" = 0
          and "ai_telemetry_events"."repair_count" = 0))
);

ALTER TABLE "itinerary_generation_attempts" ADD COLUMN "generation_id" uuid;
ALTER TABLE "ai_evaluation_case_results" ADD CONSTRAINT "ai_evaluation_case_results_evaluation_run_id_ai_evaluation_runs_id_fk" FOREIGN KEY ("evaluation_run_id") REFERENCES "public"."ai_evaluation_runs"("id") ON DELETE restrict ON UPDATE no action;
CREATE INDEX "ai_evaluation_case_results_run_idx" ON "ai_evaluation_case_results" USING btree ("evaluation_run_id");
CREATE INDEX "ai_evaluation_runs_suite_created_idx" ON "ai_evaluation_runs" USING btree ("suite_id","suite_version","created_at" DESC NULLS LAST);
CREATE INDEX "ai_evaluation_runs_prompt_model_idx" ON "ai_evaluation_runs" USING btree ("prompt_version","provider","model","created_at" DESC NULLS LAST);
CREATE UNIQUE INDEX "ai_telemetry_generation_event_uidx" ON "ai_telemetry_events" USING btree ("generation_id") WHERE "ai_telemetry_events"."event_type" = 'generation';
CREATE UNIQUE INDEX "ai_telemetry_quality_event_uidx" ON "ai_telemetry_events" USING btree ("generation_id") WHERE "ai_telemetry_events"."event_type" = 'quality';
CREATE INDEX "ai_telemetry_operation_created_idx" ON "ai_telemetry_events" USING btree ("operation","created_at" DESC NULLS LAST);
CREATE INDEX "ai_telemetry_expiry_idx" ON "ai_telemetry_events" USING btree ("expires_at");
CREATE INDEX "ai_telemetry_correlation_idx" ON "ai_telemetry_events" USING btree ("correlation_id") WHERE "ai_telemetry_events"."correlation_id" is not null;
CREATE UNIQUE INDEX "itinerary_generation_attempts_generation_id_uidx" ON "itinerary_generation_attempts" USING btree ("generation_id") WHERE "itinerary_generation_attempts"."generation_id" is not null;

ALTER TABLE "ai_evaluation_case_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_evaluation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_telemetry_events" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "ai_evaluation_case_results" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "ai_evaluation_runs" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "ai_telemetry_events" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE ai_evaluation_case_results, ai_evaluation_runs, ai_telemetry_events FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE ai_evaluation_case_results, ai_evaluation_runs, ai_telemetry_events FROM authenticated';
  END IF;
END
$$;
