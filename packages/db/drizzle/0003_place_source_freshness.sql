CREATE TABLE "destination_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" uuid NOT NULL,
	"freshness_policy_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"content_json" jsonb NOT NULL,
	"quality_state" text DEFAULT 'draft' NOT NULL,
	"refreshed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"stale_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"reviewed_at" timestamp (3) with time zone,
	"reviewed_by" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "destination_content_place_type_locale_unique" UNIQUE("place_id","content_type","locale"),
	CONSTRAINT "destination_content_type_format_chk" CHECK ("destination_content"."content_type" ~ '^[a-z][a-z0-9_.-]+$' and char_length("destination_content"."content_type") <= 100),
	CONSTRAINT "destination_content_locale_length_chk" CHECK (char_length("destination_content"."locale") between 2 and 35),
	CONSTRAINT "destination_content_json_object_chk" CHECK (jsonb_typeof("destination_content"."content_json") = 'object'),
	CONSTRAINT "destination_content_quality_state_chk" CHECK ("destination_content"."quality_state" in ('draft', 'in_review', 'approved', 'rejected')),
	CONSTRAINT "destination_content_stale_after_refresh_chk" CHECK ("destination_content"."stale_at" > "destination_content"."refreshed_at"),
	CONSTRAINT "destination_content_expiry_after_stale_chk" CHECK ("destination_content"."expires_at" > "destination_content"."stale_at"),
	CONSTRAINT "destination_content_review_metadata_chk" CHECK (("destination_content"."reviewed_at" is null and "destination_content"."reviewed_by" is null) or ("destination_content"."reviewed_at" is not null and "destination_content"."reviewed_by" is not null))
);

CREATE TABLE "destination_content_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_content_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_role" text DEFAULT 'supporting' NOT NULL,
	"retrieved_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "destination_content_sources_content_source_unique" UNIQUE("destination_content_id","source_id"),
	CONSTRAINT "destination_content_sources_role_chk" CHECK ("destination_content_sources"."source_role" in ('primary', 'supporting'))
);

CREATE TABLE "freshness_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_key" text NOT NULL,
	"version" integer NOT NULL,
	"fresh_for_seconds" integer NOT NULL,
	"expire_after_seconds" integer NOT NULL,
	"manual_review_after_seconds" integer,
	"description" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "freshness_policies_key_version_unique" UNIQUE("policy_key","version"),
	CONSTRAINT "freshness_policies_key_format_chk" CHECK ("freshness_policies"."policy_key" ~ '^[a-z][a-z0-9_.-]+$' and char_length("freshness_policies"."policy_key") <= 100),
	CONSTRAINT "freshness_policies_version_positive_chk" CHECK ("freshness_policies"."version" > 0),
	CONSTRAINT "freshness_policies_fresh_positive_chk" CHECK ("freshness_policies"."fresh_for_seconds" > 0),
	CONSTRAINT "freshness_policies_expiry_after_fresh_chk" CHECK ("freshness_policies"."expire_after_seconds" > "freshness_policies"."fresh_for_seconds"),
	CONSTRAINT "freshness_policies_review_positive_chk" CHECK ("freshness_policies"."manual_review_after_seconds" is null or "freshness_policies"."manual_review_after_seconds" > 0),
	CONSTRAINT "freshness_policies_description_length_chk" CHECK (char_length("freshness_policies"."description") between 1 and 500)
);

CREATE TABLE "place_provider_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_place_id" text NOT NULL,
	"retrieved_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_provider_ids_provider_record_unique" UNIQUE("provider","provider_place_id"),
	CONSTRAINT "place_provider_ids_provider_length_chk" CHECK (char_length("place_provider_ids"."provider") between 1 and 100),
	CONSTRAINT "place_provider_ids_record_length_chk" CHECK (char_length("place_provider_ids"."provider_place_id") between 1 and 500),
	CONSTRAINT "place_provider_ids_metadata_object_chk" CHECK (jsonb_typeof("place_provider_ids"."metadata_json") = 'object')
);

ALTER TABLE "places" DROP CONSTRAINT "places_provider_ids_object_chk";
ALTER TABLE "sources" DROP CONSTRAINT "sources_trust_tier_chk";
ALTER TABLE "sources" ALTER COLUMN "trust_tier" SET DEFAULT 'tier_3';
ALTER TABLE "sources" ADD COLUMN "title" text;
ALTER TABLE "sources" ADD COLUMN "source_kind" text DEFAULT 'licensed_provider' NOT NULL;
ALTER TABLE "sources" ADD COLUMN "license_url" text;
ALTER TABLE "sources" ADD COLUMN "attribution_text" text;
ALTER TABLE "sources" ADD COLUMN "offline_use_allowed" boolean DEFAULT false NOT NULL;
ALTER TABLE "sources" ADD COLUMN "redistribution_allowed" boolean DEFAULT false NOT NULL;
ALTER TABLE "sources" ADD COLUMN "valid_from" timestamp (3) with time zone;
ALTER TABLE "sources" ADD COLUMN "valid_until" timestamp (3) with time zone;
ALTER TABLE "sources" ADD COLUMN "created_at" timestamp (3) with time zone DEFAULT now() NOT NULL;
ALTER TABLE "sources" ADD COLUMN "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL;
INSERT INTO "place_provider_ids" (
	"place_id",
	"provider",
	"provider_place_id",
	"retrieved_at",
	"metadata_json"
)
SELECT
	"places"."id",
	"provider_ids"."provider",
	"provider_ids"."provider_place_id",
	"places"."updated_at",
	jsonb_build_object('migrated_from', 'places.provider_ids_json')
FROM "places"
CROSS JOIN LATERAL jsonb_each_text("places"."provider_ids_json") AS "provider_ids"("provider", "provider_place_id");
UPDATE "sources"
SET "trust_tier" = CASE "trust_tier"
	WHEN 'high' THEN 'tier_1'
	WHEN 'medium' THEN 'tier_3'
	WHEN 'low' THEN 'tier_4'
	ELSE "trust_tier"
END;
ALTER TABLE "destination_content" ADD CONSTRAINT "destination_content_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "destination_content" ADD CONSTRAINT "destination_content_freshness_policy_id_freshness_policies_id_fk" FOREIGN KEY ("freshness_policy_id") REFERENCES "public"."freshness_policies"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "destination_content_sources" ADD CONSTRAINT "destination_content_sources_destination_content_id_destination_content_id_fk" FOREIGN KEY ("destination_content_id") REFERENCES "public"."destination_content"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "destination_content_sources" ADD CONSTRAINT "destination_content_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "place_provider_ids" ADD CONSTRAINT "place_provider_ids_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "destination_content_policy_id_idx" ON "destination_content" USING btree ("freshness_policy_id");
CREATE INDEX "destination_content_quality_stale_idx" ON "destination_content" USING btree ("quality_state","stale_at");
CREATE INDEX "destination_content_expires_at_idx" ON "destination_content" USING btree ("expires_at");
CREATE INDEX "destination_content_manually_reviewed_idx" ON "destination_content" USING btree ("reviewed_at") WHERE "destination_content"."quality_state" = 'approved' and "destination_content"."reviewed_at" is not null;
CREATE INDEX "destination_content_sources_source_id_idx" ON "destination_content_sources" USING btree ("source_id");
CREATE INDEX "destination_content_sources_content_retrieved_idx" ON "destination_content_sources" USING btree ("destination_content_id","retrieved_at" DESC NULLS LAST);
CREATE INDEX "place_provider_ids_place_provider_idx" ON "place_provider_ids" USING btree ("place_id","provider");
CREATE INDEX "places_parent_type_name_idx" ON "places" USING btree ("parent_place_id","place_type","canonical_name");
CREATE INDEX "places_active_updated_idx" ON "places" USING btree ("updated_at") WHERE "places"."status" = 'active';
CREATE INDEX "sources_kind_valid_until_idx" ON "sources" USING btree ("source_kind","valid_until");
ALTER TABLE "places" DROP COLUMN "provider_ids_json";
ALTER TABLE "places" ADD CONSTRAINT "places_parent_not_self_chk" CHECK ("places"."parent_place_id" is null or "places"."parent_place_id" <> "places"."id");
ALTER TABLE "sources" ADD CONSTRAINT "sources_title_length_chk" CHECK ("sources"."title" is null or char_length("sources"."title") between 1 and 300);
ALTER TABLE "sources" ADD CONSTRAINT "sources_kind_chk" CHECK ("sources"."source_kind" in ('official_authority', 'official_operator', 'licensed_provider', 'reviewed_editorial'));
ALTER TABLE "sources" ADD CONSTRAINT "sources_license_url_length_chk" CHECK ("sources"."license_url" is null or char_length("sources"."license_url") between 1 and 2048);
ALTER TABLE "sources" ADD CONSTRAINT "sources_validity_order_chk" CHECK ("sources"."valid_from" is null or "sources"."valid_until" is null or "sources"."valid_until" > "sources"."valid_from");
ALTER TABLE "sources" ADD CONSTRAINT "sources_trust_tier_chk" CHECK ("sources"."trust_tier" in ('tier_1', 'tier_2', 'tier_3', 'tier_4'));
