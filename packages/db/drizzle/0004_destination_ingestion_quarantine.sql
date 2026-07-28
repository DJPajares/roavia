CREATE TABLE "destination_ingestion_quarantine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_record_id" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"errors_json" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "destination_ingestion_quarantine_provider_record_unique" UNIQUE("provider","provider_record_id"),
	CONSTRAINT "destination_ingestion_quarantine_provider_length_chk" CHECK (char_length("destination_ingestion_quarantine"."provider") between 1 and 100),
	CONSTRAINT "destination_ingestion_quarantine_record_length_chk" CHECK (char_length("destination_ingestion_quarantine"."provider_record_id") between 1 and 500),
	CONSTRAINT "destination_ingestion_quarantine_payload_object_chk" CHECK (jsonb_typeof("destination_ingestion_quarantine"."payload_json") = 'object'),
	CONSTRAINT "destination_ingestion_quarantine_errors_array_chk" CHECK (jsonb_typeof("destination_ingestion_quarantine"."errors_json") = 'array' and jsonb_array_length("destination_ingestion_quarantine"."errors_json") > 0),
	CONSTRAINT "destination_ingestion_quarantine_status_chk" CHECK ("destination_ingestion_quarantine"."status" in ('pending', 'resolved', 'discarded')),
	CONSTRAINT "destination_ingestion_quarantine_occurrence_positive_chk" CHECK ("destination_ingestion_quarantine"."occurrence_count" > 0),
	CONSTRAINT "destination_ingestion_quarantine_resolution_chk" CHECK (("destination_ingestion_quarantine"."status" = 'resolved' and "destination_ingestion_quarantine"."resolved_at" is not null) or ("destination_ingestion_quarantine"."status" <> 'resolved' and "destination_ingestion_quarantine"."resolved_at" is null))
);

CREATE INDEX "destination_ingestion_quarantine_pending_seen_idx" ON "destination_ingestion_quarantine" USING btree ("last_seen_at" DESC NULLS LAST) WHERE "destination_ingestion_quarantine"."status" = 'pending';