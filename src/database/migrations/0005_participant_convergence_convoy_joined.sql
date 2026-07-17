ALTER TYPE "public"."notification_type" ADD VALUE 'CONVOY_JOINED';--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "converged_at" timestamp with time zone;