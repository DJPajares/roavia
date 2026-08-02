CREATE TABLE "live_condition_impacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"itinerary_item_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"impact_key" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"severity" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"impact_start" date NOT NULL,
	"impact_end" date NOT NULL,
	"summary" text NOT NULL,
	"source_url" text NOT NULL,
	"source_title" text,
	"source_retrieved_at" timestamp (3) with time zone NOT NULL,
	"source_updated_at" timestamp (3) with time zone NOT NULL,
	"payload_hash" text NOT NULL,
	"first_observed_at" timestamp (3) with time zone NOT NULL,
	"last_changed_at" timestamp (3) with time zone NOT NULL,
	"resolved_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_condition_impacts_kind_chk" CHECK ("live_condition_impacts"."kind" in ('closure', 'weather')),
	CONSTRAINT "live_condition_impacts_state_chk" CHECK ("live_condition_impacts"."state" in ('active', 'resolved')),
	CONSTRAINT "live_condition_impacts_severity_chk" CHECK ("live_condition_impacts"."severity" in ('low', 'moderate', 'high', 'critical')),
	CONSTRAINT "live_condition_impacts_confidence_chk" CHECK ("live_condition_impacts"."confidence" between 0 and 1),
	CONSTRAINT "live_condition_impacts_period_chk" CHECK ("live_condition_impacts"."impact_end" >= "live_condition_impacts"."impact_start"),
	CONSTRAINT "live_condition_impacts_summary_length_chk" CHECK (char_length("live_condition_impacts"."summary") between 1 and 1000),
	CONSTRAINT "live_condition_impacts_identity_length_chk" CHECK (char_length("live_condition_impacts"."impact_key") between 3 and 1000
        and char_length("live_condition_impacts"."provider") between 1 and 100
        and char_length("live_condition_impacts"."provider_event_id") between 1 and 500),
	CONSTRAINT "live_condition_impacts_hash_chk" CHECK ("live_condition_impacts"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "live_condition_impacts_resolution_chk" CHECK (("live_condition_impacts"."state" = 'active' and "live_condition_impacts"."resolved_at" is null)
        or ("live_condition_impacts"."state" = 'resolved' and "live_condition_impacts"."resolved_at" is not null))
);

ALTER TABLE "live_condition_impacts" ADD CONSTRAINT "live_condition_impacts_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "live_condition_impacts" ADD CONSTRAINT "live_condition_impacts_itinerary_item_id_itinerary_items_id_fk" FOREIGN KEY ("itinerary_item_id") REFERENCES "public"."itinerary_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "live_condition_impacts" ADD CONSTRAINT "live_condition_impacts_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "live_condition_impacts_key_uidx" ON "live_condition_impacts" USING btree ("impact_key");
CREATE INDEX "live_condition_impacts_trip_state_idx" ON "live_condition_impacts" USING btree ("trip_id","state","kind","provider");
CREATE INDEX "live_condition_impacts_item_idx" ON "live_condition_impacts" USING btree ("itinerary_item_id");

ALTER TABLE "live_condition_impacts" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "live_condition_impacts" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE live_condition_impacts FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE live_condition_impacts FROM authenticated';
  END IF;
END
$$;
