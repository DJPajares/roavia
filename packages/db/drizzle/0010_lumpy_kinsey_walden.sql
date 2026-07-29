CREATE TABLE "assistant_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"trip_revision" integer NOT NULL,
	"kind" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"correlation_id" uuid NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"confirmed_at" timestamp (3) with time zone,
	"resolved_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_actions_revision_positive_chk" CHECK ("assistant_actions"."trip_revision" > 0),
	CONSTRAINT "assistant_actions_kind_chk" CHECK ("assistant_actions"."kind" in ('add_place', 'replace_item', 'remove_item', 'reorder_item', 'save_note')),
	CONSTRAINT "assistant_actions_payload_object_chk" CHECK (jsonb_typeof("assistant_actions"."payload_json") = 'object'),
	CONSTRAINT "assistant_actions_status_chk" CHECK ("assistant_actions"."status" in ('pending', 'confirmed', 'applied', 'cancelled', 'failed')),
	CONSTRAINT "assistant_actions_expiry_order_chk" CHECK ("assistant_actions"."expires_at" > "assistant_actions"."created_at" and "assistant_actions"."expires_at" <= "assistant_actions"."created_at" + interval '24 hours'),
	CONSTRAINT "assistant_actions_transition_timestamps_chk" CHECK (("assistant_actions"."status" = 'pending' and "assistant_actions"."confirmed_at" is null and "assistant_actions"."resolved_at" is null)
        or ("assistant_actions"."status" = 'confirmed' and "assistant_actions"."confirmed_at" is not null and "assistant_actions"."resolved_at" is null)
        or ("assistant_actions"."status" in ('applied', 'failed') and "assistant_actions"."confirmed_at" is not null and "assistant_actions"."resolved_at" is not null)
        or ("assistant_actions"."status" = 'cancelled' and "assistant_actions"."confirmed_at" is null and "assistant_actions"."resolved_at" is not null))
);

ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_trip_owner_fk" FOREIGN KEY ("trip_id","owner_user_id") REFERENCES "public"."trips"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "assistant_actions_owner_trip_created_idx" ON "assistant_actions" USING btree ("owner_user_id","trip_id","created_at" DESC NULLS LAST);
CREATE INDEX "assistant_actions_pending_expiry_idx" ON "assistant_actions" USING btree ("owner_user_id","expires_at") WHERE "assistant_actions"."status" = 'pending';

ALTER TABLE "assistant_actions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "assistant_actions" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE assistant_actions FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE assistant_actions FROM authenticated';
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
    'CREATE POLICY "assistant_actions_owner_access" ON "assistant_actions" USING (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "assistant_actions"."owner_user_id" AND "users"."auth_user_id" = %1$s)) WITH CHECK (EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "assistant_actions"."owner_user_id" AND "users"."auth_user_id" = %1$s))',
    identity_expression
  );
END
$$;
