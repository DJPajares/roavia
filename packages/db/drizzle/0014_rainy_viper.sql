CREATE TABLE "disruption_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"live_condition_impact_id" uuid NOT NULL,
	"itinerary_item_id" uuid NOT NULL,
	"original_place_id" uuid NOT NULL,
	"alternative_place_id" uuid NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"action_id" uuid,
	"failure_code" text,
	"decided_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disruption_recommendations_status_chk" CHECK ("disruption_recommendations"."status" in ('pending', 'applying', 'kept', 'dismissed', 'applied', 'failed')),
	CONSTRAINT "disruption_recommendations_distinct_places_chk" CHECK ("disruption_recommendations"."original_place_id" <> "disruption_recommendations"."alternative_place_id"),
	CONSTRAINT "disruption_recommendations_snapshot_object_chk" CHECK (jsonb_typeof("disruption_recommendations"."snapshot_json") = 'object'),
	CONSTRAINT "disruption_recommendations_decision_chk" CHECK (("disruption_recommendations"."status" in ('pending', 'applying') and "disruption_recommendations"."decided_at" is null)
        or ("disruption_recommendations"."status" in ('kept', 'dismissed', 'applied', 'failed') and "disruption_recommendations"."decided_at" is not null)),
	CONSTRAINT "disruption_recommendations_failure_chk" CHECK (("disruption_recommendations"."status" = 'failed' and "disruption_recommendations"."failure_code" is not null)
        or ("disruption_recommendations"."status" <> 'failed' and "disruption_recommendations"."failure_code" is null))
);

ALTER TABLE "disruption_recommendations" ADD CONSTRAINT "disruption_recommendations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "disruption_recommendations" ADD CONSTRAINT "disruption_recommendations_live_condition_impact_id_live_condition_impacts_id_fk" FOREIGN KEY ("live_condition_impact_id") REFERENCES "public"."live_condition_impacts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "disruption_recommendations" ADD CONSTRAINT "disruption_recommendations_itinerary_item_id_itinerary_items_id_fk" FOREIGN KEY ("itinerary_item_id") REFERENCES "public"."itinerary_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "disruption_recommendations" ADD CONSTRAINT "disruption_recommendations_original_place_id_places_id_fk" FOREIGN KEY ("original_place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "disruption_recommendations" ADD CONSTRAINT "disruption_recommendations_alternative_place_id_places_id_fk" FOREIGN KEY ("alternative_place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "disruption_recommendations" ADD CONSTRAINT "disruption_recommendations_action_id_assistant_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."assistant_actions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "disruption_recommendations" ADD CONSTRAINT "disruption_recommendations_trip_owner_fk" FOREIGN KEY ("trip_id","owner_user_id") REFERENCES "public"."trips"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "disruption_recommendations_impact_uidx" ON "disruption_recommendations" USING btree ("live_condition_impact_id");
CREATE INDEX "disruption_recommendations_owner_trip_status_idx" ON "disruption_recommendations" USING btree ("owner_user_id","trip_id","status","created_at" DESC NULLS LAST);
CREATE INDEX "disruption_recommendations_action_idx" ON "disruption_recommendations" USING btree ("action_id");

ALTER TABLE "disruption_recommendations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE "disruption_recommendations" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE disruption_recommendations FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE disruption_recommendations FROM authenticated';
  END IF;
END
$$;
