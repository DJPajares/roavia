CREATE TABLE "account_deletion_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_version" text DEFAULT '2026-07-28.v1' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"checklist_json" jsonb NOT NULL,
	"failure_codes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_at" timestamp (3) with time zone NOT NULL,
	"live_delete_by" timestamp (3) with time zone NOT NULL,
	"backup_delete_by" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "account_deletion_receipts_policy_chk" CHECK ("account_deletion_receipts"."policy_version" = '2026-07-28.v1'),
	CONSTRAINT "account_deletion_receipts_status_chk" CHECK ("account_deletion_receipts"."status" in ('pending', 'completed', 'failed')),
	CONSTRAINT "account_deletion_receipts_checklist_chk" CHECK (jsonb_typeof("account_deletion_receipts"."checklist_json") = 'object' and jsonb_typeof("account_deletion_receipts"."failure_codes_json") = 'array'),
	CONSTRAINT "account_deletion_receipts_deadlines_chk" CHECK ("account_deletion_receipts"."live_delete_by" = "account_deletion_receipts"."confirmed_at" + interval '24 hours'
        and "account_deletion_receipts"."backup_delete_by" = "account_deletion_receipts"."confirmed_at" + interval '31 days'
        and "account_deletion_receipts"."expires_at" = "account_deletion_receipts"."confirmed_at" + interval '12 months'),
	CONSTRAINT "account_deletion_receipts_completion_chk" CHECK (("account_deletion_receipts"."status" = 'completed') = ("account_deletion_receipts"."completed_at" is not null))
);

CREATE TABLE "account_deletion_tombstones" (
	"subject_hash" "bytea" PRIMARY KEY NOT NULL,
	"deletion_receipt_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "account_deletion_tombstones_hash_length_chk" CHECK (octet_length("account_deletion_tombstones"."subject_hash") = 32),
	CONSTRAINT "account_deletion_tombstones_expiry_chk" CHECK ("account_deletion_tombstones"."expires_at" = "account_deletion_tombstones"."created_at" + interval '31 days')
);

CREATE TABLE "account_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"artifact_ciphertext" "bytea" NOT NULL,
	"encryption_iv" "bytea" NOT NULL,
	"encryption_tag" "bytea" NOT NULL,
	"grant_hash" "bytea" NOT NULL,
	"size_bytes" bigint NOT NULL,
	"downloaded_at" timestamp (3) with time zone,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_exports_iv_length_chk" CHECK (octet_length("account_exports"."encryption_iv") = 12),
	CONSTRAINT "account_exports_tag_length_chk" CHECK (octet_length("account_exports"."encryption_tag") = 16),
	CONSTRAINT "account_exports_grant_hash_length_chk" CHECK (octet_length("account_exports"."grant_hash") = 32),
	CONSTRAINT "account_exports_size_positive_chk" CHECK ("account_exports"."size_bytes" > 0),
	CONSTRAINT "account_exports_expiry_order_chk" CHECK ("account_exports"."expires_at" > "account_exports"."created_at" and "account_exports"."expires_at" <= "account_exports"."created_at" + interval '24 hours')
);

ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_chk";
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_subject_type_chk";
ALTER TABLE "account_deletion_tombstones" ADD CONSTRAINT "account_deletion_tombstones_deletion_receipt_id_account_deletion_receipts_id_fk" FOREIGN KEY ("deletion_receipt_id") REFERENCES "public"."account_deletion_receipts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "account_exports" ADD CONSTRAINT "account_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "account_deletion_receipts_status_confirmed_idx" ON "account_deletion_receipts" USING btree ("status","confirmed_at" DESC NULLS LAST);
CREATE INDEX "account_deletion_receipts_expiry_idx" ON "account_deletion_receipts" USING btree ("expires_at");
CREATE UNIQUE INDEX "account_deletion_tombstones_receipt_uidx" ON "account_deletion_tombstones" USING btree ("deletion_receipt_id");
CREATE INDEX "account_deletion_tombstones_expiry_idx" ON "account_deletion_tombstones" USING btree ("expires_at");
CREATE UNIQUE INDEX "account_exports_grant_hash_uidx" ON "account_exports" USING btree ("grant_hash");
CREATE INDEX "account_exports_user_created_idx" ON "account_exports" USING btree ("user_id","created_at" DESC NULLS LAST);
CREATE INDEX "account_exports_expiry_idx" ON "account_exports" USING btree ("expires_at");
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_chk" CHECK ("audit_events"."action" in ('share_link_created', 'share_link_revoked', 'resource_deleted', 'ai_action_applied', 'account_export_created', 'account_export_downloaded', 'account_deletion_requested', 'account_deletion_completed'));
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_subject_type_chk" CHECK ("audit_events"."subject_type" in ('account', 'trip', 'share_link', 'itinerary_item', 'assistant_action', 'account_export', 'deletion_receipt'));

ALTER TABLE "account_deletion_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_deletion_tombstones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_exports" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  "account_deletion_receipts",
  "account_deletion_tombstones",
  "account_exports"
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE account_deletion_receipts, account_deletion_tombstones, account_exports FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE account_deletion_receipts, account_deletion_tombstones, account_exports FROM authenticated';
  END IF;
END
$$;
