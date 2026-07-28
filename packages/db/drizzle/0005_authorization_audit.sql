CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"occurred_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone DEFAULT now() + interval '12 months' NOT NULL,
	CONSTRAINT "audit_events_action_chk" CHECK ("audit_events"."action" in ('share_link_created', 'share_link_revoked', 'resource_deleted', 'ai_action_applied')),
	CONSTRAINT "audit_events_outcome_chk" CHECK ("audit_events"."outcome" in ('succeeded', 'denied', 'failed')),
	CONSTRAINT "audit_events_subject_type_chk" CHECK ("audit_events"."subject_type" in ('account', 'trip', 'share_link', 'itinerary_item', 'assistant_action')),
	CONSTRAINT "audit_events_expiry_order_chk" CHECK ("audit_events"."expires_at" > "audit_events"."occurred_at")
);

ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "audit_events_actor_occurred_id_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);
CREATE INDEX "audit_events_subject_occurred_idx" ON "audit_events" USING btree ("subject_type","subject_id","occurred_at" DESC NULLS LAST);
CREATE INDEX "audit_events_expires_at_idx" ON "audit_events" USING btree ("expires_at");

-- Private product data is only exposed through the API's scoped repositories.
-- RLS and explicit privilege revocation provide a second boundary if a table is
-- accidentally exposed through Supabase's Data API later.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "travel_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trip_destinations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "itinerary_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "itinerary_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "share_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offline_packages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  "users",
  "travel_profiles",
  "trips",
  "trip_destinations",
  "itinerary_days",
  "itinerary_items",
  "share_links",
  "offline_packages",
  "audit_events"
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE users, travel_profiles, trips, trip_destinations, itinerary_days, itinerary_items, share_links, offline_packages, audit_events FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE users, travel_profiles, trips, trip_destinations, itinerary_days, itinerary_items, share_links, offline_packages, audit_events FROM authenticated';
  END IF;
END
$$;

-- Supabase deployments derive identity from auth.uid(). The local PostgreSQL
-- integration database has no auth schema, so it uses a transaction-local GUC.
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
    'CREATE POLICY "users_owner_access" ON "users" USING ("auth_user_id" = %1$s) WITH CHECK ("auth_user_id" = %1$s)',
    identity_expression
  );
  EXECUTE format(
    'CREATE POLICY "travel_profiles_owner_access" ON "travel_profiles" USING (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "travel_profiles"."user_id" AND "users"."auth_user_id" = %1$s)) WITH CHECK (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "travel_profiles"."user_id" AND "users"."auth_user_id" = %1$s))',
    identity_expression
  );
  EXECUTE format(
    'CREATE POLICY "trips_owner_access" ON "trips" USING (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "trips"."owner_user_id" AND "users"."auth_user_id" = %1$s)) WITH CHECK (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "trips"."owner_user_id" AND "users"."auth_user_id" = %1$s))',
    identity_expression
  );
  EXECUTE format(
    'CREATE POLICY "trip_destinations_owner_access" ON "trip_destinations" USING (EXISTS (SELECT 1 FROM "trips" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "trips"."id" = "trip_destinations"."trip_id" AND "users"."auth_user_id" = %1$s)) WITH CHECK (EXISTS (SELECT 1 FROM "trips" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "trips"."id" = "trip_destinations"."trip_id" AND "users"."auth_user_id" = %1$s))',
    identity_expression
  );
  EXECUTE format(
    'CREATE POLICY "itinerary_days_owner_access" ON "itinerary_days" USING (EXISTS (SELECT 1 FROM "trips" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "trips"."id" = "itinerary_days"."trip_id" AND "users"."auth_user_id" = %1$s)) WITH CHECK (EXISTS (SELECT 1 FROM "trips" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "trips"."id" = "itinerary_days"."trip_id" AND "users"."auth_user_id" = %1$s))',
    identity_expression
  );
  EXECUTE format(
    'CREATE POLICY "itinerary_items_owner_access" ON "itinerary_items" USING (EXISTS (SELECT 1 FROM "itinerary_days" INNER JOIN "trips" ON "trips"."id" = "itinerary_days"."trip_id" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "itinerary_days"."id" = "itinerary_items"."itinerary_day_id" AND "users"."auth_user_id" = %1$s)) WITH CHECK (EXISTS (SELECT 1 FROM "itinerary_days" INNER JOIN "trips" ON "trips"."id" = "itinerary_days"."trip_id" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "itinerary_days"."id" = "itinerary_items"."itinerary_day_id" AND "users"."auth_user_id" = %1$s))',
    identity_expression
  );
  EXECUTE format(
    'CREATE POLICY "share_links_owner_access" ON "share_links" USING (EXISTS (SELECT 1 FROM "trips" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "trips"."id" = "share_links"."trip_id" AND "users"."auth_user_id" = %1$s)) WITH CHECK (EXISTS (SELECT 1 FROM "trips" INNER JOIN "users" ON "users"."id" = "trips"."owner_user_id" WHERE "trips"."id" = "share_links"."trip_id" AND "users"."auth_user_id" = %1$s))',
    identity_expression
  );
  EXECUTE format(
    'CREATE POLICY "offline_packages_owner_access" ON "offline_packages" USING (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "offline_packages"."user_id" AND "users"."auth_user_id" = %1$s)) WITH CHECK (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "offline_packages"."user_id" AND "users"."auth_user_id" = %1$s))',
    identity_expression
  );
  EXECUTE format(
    'CREATE POLICY "audit_events_actor_access" ON "audit_events" USING (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "audit_events"."actor_user_id" AND "users"."auth_user_id" = %1$s)) WITH CHECK (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "audit_events"."actor_user_id" AND "users"."auth_user_id" = %1$s))',
    identity_expression
  );
END
$$;
