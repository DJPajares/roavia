ALTER TABLE "share_links" DROP CONSTRAINT "share_links_expiry_order_chk";
UPDATE "share_links"
SET "expires_at" = "created_at" + interval '30 days'
WHERE "expires_at" IS NULL;
UPDATE "share_links"
SET "expires_at" = "created_at" + interval '180 days'
WHERE "expires_at" > "created_at" + interval '180 days';
ALTER TABLE "share_links" ALTER COLUMN "expires_at" SET NOT NULL;
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_expiry_order_chk" CHECK ("share_links"."expires_at" > "share_links"."created_at" and "share_links"."expires_at" <= "share_links"."created_at" + interval '180 days');
