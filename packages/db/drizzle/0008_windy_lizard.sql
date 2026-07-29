CREATE TABLE "itinerary_generation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_run_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"kind" text NOT NULL,
	"repair_number" integer,
	"outcome" text NOT NULL,
	"issue_codes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_amount_micros" bigint,
	"cost_currency" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itinerary_generation_attempts_run_number_unique" UNIQUE("generation_run_id","attempt_number"),
	CONSTRAINT "itinerary_generation_attempts_number_positive_chk" CHECK ("itinerary_generation_attempts"."attempt_number" > 0),
	CONSTRAINT "itinerary_generation_attempts_kind_chk" CHECK ("itinerary_generation_attempts"."kind" in ('initial', 'repair')),
	CONSTRAINT "itinerary_generation_attempts_repair_number_chk" CHECK (("itinerary_generation_attempts"."kind" = 'repair' and "itinerary_generation_attempts"."repair_number" > 0) or ("itinerary_generation_attempts"."kind" = 'initial' and "itinerary_generation_attempts"."repair_number" is null)),
	CONSTRAINT "itinerary_generation_attempts_outcome_chk" CHECK ("itinerary_generation_attempts"."outcome" in ('accepted', 'rejected', 'provider_error')),
	CONSTRAINT "itinerary_generation_attempts_issue_codes_array_chk" CHECK (jsonb_typeof("itinerary_generation_attempts"."issue_codes_json") = 'array'),
	CONSTRAINT "itinerary_generation_attempts_duration_nonnegative_chk" CHECK ("itinerary_generation_attempts"."duration_ms" >= 0),
	CONSTRAINT "itinerary_generation_attempts_tokens_nonnegative_chk" CHECK (("itinerary_generation_attempts"."input_tokens" is null or "itinerary_generation_attempts"."input_tokens" >= 0) and ("itinerary_generation_attempts"."output_tokens" is null or "itinerary_generation_attempts"."output_tokens" >= 0) and ("itinerary_generation_attempts"."total_tokens" is null or "itinerary_generation_attempts"."total_tokens" >= 0)),
	CONSTRAINT "itinerary_generation_attempts_cost_pair_chk" CHECK (("itinerary_generation_attempts"."cost_amount_micros" is null) = ("itinerary_generation_attempts"."cost_currency" is null))
);

CREATE TABLE "itinerary_generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"trip_revision" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"max_repair_attempts" integer NOT NULL,
	"repair_attempts" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"grounding_schema_version" text,
	"grounding_status" text,
	"assumptions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overall_confidence" numeric(4, 3),
	"failure_code" text,
	"correlation_id" uuid NOT NULL,
	"started_at" timestamp (3) with time zone,
	"completed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itinerary_generation_runs_trip_revision_unique" UNIQUE("trip_id","trip_revision"),
	CONSTRAINT "itinerary_generation_runs_revision_positive_chk" CHECK ("itinerary_generation_runs"."trip_revision" > 0),
	CONSTRAINT "itinerary_generation_runs_prompt_version_chk" CHECK ("itinerary_generation_runs"."prompt_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
	CONSTRAINT "itinerary_generation_runs_repair_bounds_chk" CHECK ("itinerary_generation_runs"."max_repair_attempts" between 0 and 3 and "itinerary_generation_runs"."repair_attempts" between 0 and "itinerary_generation_runs"."max_repair_attempts"),
	CONSTRAINT "itinerary_generation_runs_status_chk" CHECK ("itinerary_generation_runs"."status" in ('queued', 'retrieving', 'generating', 'validating', 'repairing', 'persisting', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "itinerary_generation_runs_grounding_status_chk" CHECK ("itinerary_generation_runs"."grounding_status" is null or "itinerary_generation_runs"."grounding_status" in ('complete', 'partial', 'empty')),
	CONSTRAINT "itinerary_generation_runs_assumptions_array_chk" CHECK (jsonb_typeof("itinerary_generation_runs"."assumptions_json") = 'array'),
	CONSTRAINT "itinerary_generation_runs_warnings_array_chk" CHECK (jsonb_typeof("itinerary_generation_runs"."warnings_json") = 'array'),
	CONSTRAINT "itinerary_generation_runs_sources_array_chk" CHECK (jsonb_typeof("itinerary_generation_runs"."sources_json") = 'array'),
	CONSTRAINT "itinerary_generation_runs_confidence_range_chk" CHECK ("itinerary_generation_runs"."overall_confidence" is null or "itinerary_generation_runs"."overall_confidence" between 0 and 1),
	CONSTRAINT "itinerary_generation_runs_completion_chk" CHECK (("itinerary_generation_runs"."status" in ('succeeded', 'failed', 'cancelled')) = ("itinerary_generation_runs"."completed_at" is not null))
);

ALTER TABLE "itinerary_generation_attempts" ADD CONSTRAINT "itinerary_generation_attempts_generation_run_id_itinerary_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."itinerary_generation_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "itinerary_generation_runs" ADD CONSTRAINT "itinerary_generation_runs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "itinerary_generation_runs" ADD CONSTRAINT "itinerary_generation_runs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "itinerary_generation_attempts_run_created_idx" ON "itinerary_generation_attempts" USING btree ("generation_run_id","created_at");
CREATE UNIQUE INDEX "itinerary_generation_runs_active_trip_uidx" ON "itinerary_generation_runs" USING btree ("trip_id") WHERE "itinerary_generation_runs"."status" in ('queued', 'retrieving', 'generating', 'validating', 'repairing', 'persisting');
CREATE INDEX "itinerary_generation_runs_trip_created_idx" ON "itinerary_generation_runs" USING btree ("trip_id","created_at" DESC NULLS LAST);
CREATE INDEX "itinerary_generation_runs_requester_created_idx" ON "itinerary_generation_runs" USING btree ("requested_by_user_id","created_at" DESC NULLS LAST);

-- Generation metadata contains precise trip timing and selected places. Keep it
-- behind the same owner-only boundary as itinerary rows and expose it through
-- scoped repositories, not direct Data API table access.
ALTER TABLE "itinerary_generation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "itinerary_generation_attempts" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  "itinerary_generation_runs",
  "itinerary_generation_attempts"
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE itinerary_generation_runs, itinerary_generation_attempts FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE itinerary_generation_runs, itinerary_generation_attempts FROM authenticated';
  END IF;
END
$$;

DO $$
DECLARE
  identity_expression text;
BEGIN
  IF to_regprocedure('auth.uid()') IS NOT NULL THEN
    identity_expression := 'auth.uid()::text';
  ELSE
    identity_expression := 'nullif(current_setting(''roavia.auth_user_id'', true), '''')';
  END IF;

  EXECUTE format(
    'CREATE POLICY "itinerary_generation_runs_owner_access" ON "itinerary_generation_runs" USING (EXISTS (SELECT 1 FROM "trips" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "trips"."id" = "itinerary_generation_runs"."trip_id" AND "users"."auth_user_id" = %1$s)) WITH CHECK (EXISTS (SELECT 1 FROM "trips" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "trips"."id" = "itinerary_generation_runs"."trip_id" AND "users"."auth_user_id" = %1$s))',
    identity_expression
  );
  EXECUTE format(
    'CREATE POLICY "itinerary_generation_attempts_owner_access" ON "itinerary_generation_attempts" USING (EXISTS (SELECT 1 FROM "itinerary_generation_runs" INNER JOIN "trips" ON "trips"."id" = "itinerary_generation_runs"."trip_id" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "itinerary_generation_runs"."id" = "itinerary_generation_attempts"."generation_run_id" AND "users"."auth_user_id" = %1$s)) WITH CHECK (EXISTS (SELECT 1 FROM "itinerary_generation_runs" INNER JOIN "trips" ON "trips"."id" = "itinerary_generation_runs"."trip_id" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "itinerary_generation_runs"."id" = "itinerary_generation_attempts"."generation_run_id" AND "users"."auth_user_id" = %1$s))',
    identity_expression
  );
END
$$;
