ALTER TABLE "trips" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "trips" ADD CONSTRAINT "trips_revision_positive_chk" CHECK ("trips"."revision" > 0);
