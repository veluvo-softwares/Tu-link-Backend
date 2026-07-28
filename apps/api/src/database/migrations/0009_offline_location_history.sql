ALTER TABLE "locations" ADD COLUMN "recorded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "received_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "client_point_id" text;
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "backfilled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "locations"
SET "recorded_at" = "created_at", "received_at" = "created_at"
WHERE "recorded_at" IS NULL OR "received_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "recorded_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "recorded_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "received_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "received_at" SET DEFAULT now();
--> statement-breakpoint
CREATE INDEX "idx_loc_recorded" ON "locations" USING btree ("journey_id", "participant_id", "recorded_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_loc_client_point" ON "locations" USING btree ("journey_id", "participant_id", "client_point_id") WHERE "client_point_id" IS NOT NULL;
