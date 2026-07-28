ALTER TYPE "public"."notification_type" ADD VALUE 'JOURNEY_REMINDER';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'JOURNEY_STARTING_NOW';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'JOURNEY_MISSED_START';--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_journeys_scheduled" ON "journeys" USING btree ("scheduled_for") WHERE status = 'PENDING' AND scheduled_for IS NOT NULL;