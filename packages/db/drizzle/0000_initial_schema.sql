CREATE TABLE "itinerary_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"timezone" text NOT NULL,
	"title" text,
	"notes" text,
	"order_index" integer NOT NULL,
	CONSTRAINT "itinerary_days_trip_order_unique" UNIQUE("trip_id","order_index"),
	CONSTRAINT "itinerary_days_trip_date_unique" UNIQUE("trip_id","local_date"),
	CONSTRAINT "itinerary_days_order_nonnegative_chk" CHECK ("itinerary_days"."order_index" >= 0),
	CONSTRAINT "itinerary_days_timezone_length_chk" CHECK (char_length("itinerary_days"."timezone") between 1 and 100),
	CONSTRAINT "itinerary_days_title_length_chk" CHECK ("itinerary_days"."title" is null or char_length("itinerary_days"."title") between 1 and 200)
);

CREATE TABLE "itinerary_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"itinerary_day_id" uuid NOT NULL,
	"place_id" uuid,
	"item_type" text NOT NULL,
	"start_time" time(0),
	"end_time" time(0),
	"duration_minutes" integer,
	"estimated_cost_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transport_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"booking_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" numeric(4, 3),
	"notes" text,
	"order_index" integer NOT NULL,
	CONSTRAINT "itinerary_items_day_order_unique" UNIQUE("itinerary_day_id","order_index"),
	CONSTRAINT "itinerary_items_type_chk" CHECK ("itinerary_items"."item_type" in ('activity', 'food', 'lodging', 'transport', 'note')),
	CONSTRAINT "itinerary_items_order_nonnegative_chk" CHECK ("itinerary_items"."order_index" >= 0),
	CONSTRAINT "itinerary_items_time_pair_chk" CHECK (("itinerary_items"."start_time" is null) = ("itinerary_items"."end_time" is null)),
	CONSTRAINT "itinerary_items_time_order_chk" CHECK ("itinerary_items"."start_time" is null or "itinerary_items"."end_time" > "itinerary_items"."start_time"),
	CONSTRAINT "itinerary_items_duration_positive_chk" CHECK ("itinerary_items"."duration_minutes" is null or "itinerary_items"."duration_minutes" > 0),
	CONSTRAINT "itinerary_items_estimated_cost_object_chk" CHECK (jsonb_typeof("itinerary_items"."estimated_cost_json") = 'object'),
	CONSTRAINT "itinerary_items_transport_object_chk" CHECK (jsonb_typeof("itinerary_items"."transport_json") = 'object'),
	CONSTRAINT "itinerary_items_booking_object_chk" CHECK (jsonb_typeof("itinerary_items"."booking_json") = 'object'),
	CONSTRAINT "itinerary_items_source_snapshot_object_chk" CHECK (jsonb_typeof("itinerary_items"."source_snapshot_json") = 'object'),
	CONSTRAINT "itinerary_items_confidence_range_chk" CHECK ("itinerary_items"."confidence" is null or "itinerary_items"."confidence" between 0 and 1)
);

CREATE TABLE "offline_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"generated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"size_bytes" bigint NOT NULL,
	CONSTRAINT "offline_packages_user_trip_version_unique" UNIQUE("user_id","trip_id","version"),
	CONSTRAINT "offline_packages_version_positive_chk" CHECK ("offline_packages"."version" > 0),
	CONSTRAINT "offline_packages_manifest_object_chk" CHECK (jsonb_typeof("offline_packages"."manifest_json") = 'object'),
	CONSTRAINT "offline_packages_size_nonnegative_chk" CHECK ("offline_packages"."size_bytes" >= 0),
	CONSTRAINT "offline_packages_expiry_order_chk" CHECK ("offline_packages"."expires_at" is null or "offline_packages"."expires_at" > "offline_packages"."generated_at")
);

CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_place_id" uuid,
	"place_type" text NOT NULL,
	"canonical_name" text NOT NULL,
	"localized_names_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(10, 6),
	"timezone" text,
	"country_code" text,
	"provider_ids_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_type_chk" CHECK ("places"."place_type" in ('country', 'region', 'city', 'district', 'poi', 'transit_hub')),
	CONSTRAINT "places_name_length_chk" CHECK (char_length("places"."canonical_name") between 1 and 200),
	CONSTRAINT "places_localized_names_object_chk" CHECK (jsonb_typeof("places"."localized_names_json") = 'object'),
	CONSTRAINT "places_provider_ids_object_chk" CHECK (jsonb_typeof("places"."provider_ids_json") = 'object'),
	CONSTRAINT "places_coordinate_pair_chk" CHECK (("places"."latitude" is null) = ("places"."longitude" is null)),
	CONSTRAINT "places_latitude_range_chk" CHECK ("places"."latitude" is null or "places"."latitude" between -90 and 90),
	CONSTRAINT "places_longitude_range_chk" CHECK ("places"."longitude" is null or "places"."longitude" between -180 and 180),
	CONSTRAINT "places_country_code_format_chk" CHECK ("places"."country_code" is null or "places"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "places_status_chk" CHECK ("places"."status" in ('active', 'deprecated'))
);

CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"permission" text DEFAULT 'view' NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_hash_length_chk" CHECK (octet_length("share_links"."token_hash") = 32),
	CONSTRAINT "share_links_permission_chk" CHECK ("share_links"."permission" in ('view')),
	CONSTRAINT "share_links_expiry_order_chk" CHECK ("share_links"."expires_at" is null or "share_links"."expires_at" > "share_links"."created_at"),
	CONSTRAINT "share_links_revocation_order_chk" CHECK ("share_links"."revoked_at" is null or "share_links"."revoked_at" >= "share_links"."created_at")
);

CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"source_url" text NOT NULL,
	"license" text,
	"retrieved_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp (3) with time zone,
	"trust_tier" text DEFAULT 'medium' NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "sources_provider_url_unique" UNIQUE("provider","source_url"),
	CONSTRAINT "sources_provider_length_chk" CHECK (char_length("sources"."provider") between 1 and 100),
	CONSTRAINT "sources_url_length_chk" CHECK (char_length("sources"."source_url") between 1 and 2048),
	CONSTRAINT "sources_trust_tier_chk" CHECK ("sources"."trust_tier" in ('low', 'medium', 'high')),
	CONSTRAINT "sources_metadata_object_chk" CHECK (jsonb_typeof("sources"."metadata_json") = 'object')
);

CREATE TABLE "travel_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"default_budget_style" text DEFAULT 'midrange' NOT NULL,
	"default_pace" text DEFAULT 'balanced' NOT NULL,
	"interests_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dietary_needs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accessibility_needs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"travel_preferences_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_profiles_budget_style_chk" CHECK ("travel_profiles"."default_budget_style" in ('budget', 'midrange', 'premium', 'luxury')),
	CONSTRAINT "travel_profiles_pace_chk" CHECK ("travel_profiles"."default_pace" in ('slow', 'balanced', 'fast')),
	CONSTRAINT "travel_profiles_interests_array_chk" CHECK (jsonb_typeof("travel_profiles"."interests_json") = 'array'),
	CONSTRAINT "travel_profiles_dietary_needs_array_chk" CHECK (jsonb_typeof("travel_profiles"."dietary_needs_json") = 'array'),
	CONSTRAINT "travel_profiles_accessibility_needs_array_chk" CHECK (jsonb_typeof("travel_profiles"."accessibility_needs_json") = 'array'),
	CONSTRAINT "travel_profiles_preferences_object_chk" CHECK (jsonb_typeof("travel_profiles"."travel_preferences_json") = 'object')
);

CREATE TABLE "trip_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"arrival_at" timestamp (3) with time zone,
	"departure_at" timestamp (3) with time zone,
	"order_index" integer NOT NULL,
	CONSTRAINT "trip_destinations_trip_order_unique" UNIQUE("trip_id","order_index"),
	CONSTRAINT "trip_destinations_trip_place_unique" UNIQUE("trip_id","place_id"),
	CONSTRAINT "trip_destinations_order_nonnegative_chk" CHECK ("trip_destinations"."order_index" >= 0),
	CONSTRAINT "trip_destinations_time_order_chk" CHECK ("trip_destinations"."arrival_at" is null or "trip_destinations"."departure_at" is null or "trip_destinations"."departure_at" > "trip_destinations"."arrival_at")
);

CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"origin_place_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"date_flexibility_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"traveler_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"generation_state" text DEFAULT 'idle' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_owner_slug_unique" UNIQUE("owner_user_id","slug"),
	CONSTRAINT "trips_id_owner_unique" UNIQUE("id","owner_user_id"),
	CONSTRAINT "trips_title_length_chk" CHECK (char_length("trips"."title") between 1 and 200),
	CONSTRAINT "trips_slug_format_chk" CHECK ("trips"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length("trips"."slug") <= 120),
	CONSTRAINT "trips_date_order_chk" CHECK ("trips"."end_date" >= "trips"."start_date"),
	CONSTRAINT "trips_date_flexibility_object_chk" CHECK (jsonb_typeof("trips"."date_flexibility_json") = 'object'),
	CONSTRAINT "trips_traveler_summary_object_chk" CHECK (jsonb_typeof("trips"."traveler_summary_json") = 'object'),
	CONSTRAINT "trips_budget_object_chk" CHECK (jsonb_typeof("trips"."budget_json") = 'object'),
	CONSTRAINT "trips_status_chk" CHECK ("trips"."status" in ('draft', 'active', 'archived')),
	CONSTRAINT "trips_visibility_chk" CHECK ("trips"."visibility" in ('private', 'link')),
	CONSTRAINT "trips_generation_state_chk" CHECK ("trips"."generation_state" in ('idle', 'queued', 'generating', 'ready', 'failed'))
);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"home_country" text,
	"preferred_currency" text DEFAULT 'USD' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_display_name_length_chk" CHECK (char_length("users"."display_name") between 1 and 100),
	CONSTRAINT "users_home_country_format_chk" CHECK ("users"."home_country" is null or "users"."home_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "users_preferred_currency_format_chk" CHECK ("users"."preferred_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "users_locale_length_chk" CHECK (char_length("users"."locale") between 2 and 35),
	CONSTRAINT "users_timezone_length_chk" CHECK (char_length("users"."timezone") between 1 and 100)
);

ALTER TABLE "itinerary_days" ADD CONSTRAINT "itinerary_days_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_itinerary_day_id_itinerary_days_id_fk" FOREIGN KEY ("itinerary_day_id") REFERENCES "public"."itinerary_days"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "offline_packages" ADD CONSTRAINT "offline_packages_trip_owner_fk" FOREIGN KEY ("trip_id","user_id") REFERENCES "public"."trips"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "places" ADD CONSTRAINT "places_parent_place_id_places_id_fk" FOREIGN KEY ("parent_place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "travel_profiles" ADD CONSTRAINT "travel_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "trip_destinations" ADD CONSTRAINT "trip_destinations_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "trip_destinations" ADD CONSTRAINT "trip_destinations_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "trips" ADD CONSTRAINT "trips_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "trips" ADD CONSTRAINT "trips_origin_place_id_places_id_fk" FOREIGN KEY ("origin_place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "itinerary_items_place_id_idx" ON "itinerary_items" USING btree ("place_id");
CREATE INDEX "offline_packages_trip_id_idx" ON "offline_packages" USING btree ("trip_id");
CREATE INDEX "offline_packages_user_generated_idx" ON "offline_packages" USING btree ("user_id","generated_at" DESC NULLS LAST);
CREATE INDEX "places_parent_place_id_idx" ON "places" USING btree ("parent_place_id");
CREATE INDEX "places_country_type_name_idx" ON "places" USING btree ("country_code","place_type","canonical_name");
CREATE UNIQUE INDEX "share_links_token_hash_uidx" ON "share_links" USING btree ("token_hash");
CREATE INDEX "share_links_trip_id_idx" ON "share_links" USING btree ("trip_id");
CREATE INDEX "share_links_active_trip_idx" ON "share_links" USING btree ("trip_id","expires_at") WHERE "share_links"."revoked_at" is null;
CREATE INDEX "sources_provider_retrieved_at_idx" ON "sources" USING btree ("provider","retrieved_at" DESC NULLS LAST);
CREATE UNIQUE INDEX "travel_profiles_user_id_uidx" ON "travel_profiles" USING btree ("user_id");
CREATE INDEX "trip_destinations_place_id_idx" ON "trip_destinations" USING btree ("place_id");
CREATE INDEX "trips_owner_updated_id_idx" ON "trips" USING btree ("owner_user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);
CREATE INDEX "trips_origin_place_id_idx" ON "trips" USING btree ("origin_place_id");
CREATE INDEX "trips_owner_status_idx" ON "trips" USING btree ("owner_user_id","status");
CREATE UNIQUE INDEX "users_auth_user_id_uidx" ON "users" USING btree ("auth_user_id");