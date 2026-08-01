CREATE TABLE "seasonal_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"period_kind" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"computed_insight_json" jsonb NOT NULL,
	"computed_hash" text NOT NULL,
	"source_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refreshed_at" timestamp (3) with time zone NOT NULL,
	"reviewed_override_json" jsonb,
	"reviewed_at" timestamp (3) with time zone,
	"reviewed_by" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasonal_insights_place_period_unique" UNIQUE("place_id","period_key"),
	CONSTRAINT "seasonal_insights_period_kind_chk" CHECK ("seasonal_insights"."period_kind" in ('month', 'date_range')),
	CONSTRAINT "seasonal_insights_period_order_chk" CHECK ("seasonal_insights"."period_end" >= "seasonal_insights"."period_start"),
	CONSTRAINT "seasonal_insights_period_key_chk" CHECK ("seasonal_insights"."period_key" ~ '^(month:[0-9]{4}-(0[1-9]|1[0-2])|range:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{4}-[0-9]{2}-[0-9]{2})$'),
	CONSTRAINT "seasonal_insights_computed_object_chk" CHECK (jsonb_typeof("seasonal_insights"."computed_insight_json") = 'object'),
	CONSTRAINT "seasonal_insights_sources_array_chk" CHECK (jsonb_typeof("seasonal_insights"."source_ids_json") = 'array'),
	CONSTRAINT "seasonal_insights_hash_chk" CHECK ("seasonal_insights"."computed_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "seasonal_insights_override_object_chk" CHECK ("seasonal_insights"."reviewed_override_json" is null or jsonb_typeof("seasonal_insights"."reviewed_override_json") = 'object'),
	CONSTRAINT "seasonal_insights_review_pair_chk" CHECK (("seasonal_insights"."reviewed_at" is null and "seasonal_insights"."reviewed_by" is null and "seasonal_insights"."reviewed_override_json" is null)
        or ("seasonal_insights"."reviewed_at" is not null and "seasonal_insights"."reviewed_by" is not null and "seasonal_insights"."reviewed_override_json" is not null))
);

ALTER TABLE "seasonal_insights" ADD CONSTRAINT "seasonal_insights_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "seasonal_insights_place_period_idx" ON "seasonal_insights" USING btree ("place_id","period_start","period_end");
CREATE INDEX "seasonal_insights_refreshed_at_idx" ON "seasonal_insights" USING btree ("refreshed_at");

ALTER TABLE "seasonal_insights" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "seasonal_insights" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE seasonal_insights FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE seasonal_insights FROM authenticated';
  END IF;
END
$$;
