ALTER TABLE "journeys" ADD COLUMN "invite_code" text;--> statement-breakpoint
UPDATE "journeys"
SET "invite_code" = upper(substr(translate(md5(random()::text || "id"::text || clock_timestamp()::text), '01', 'AB'), 1, 10));--> statement-breakpoint
ALTER TABLE "journeys" ALTER COLUMN "invite_code" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_journeys_invite_code" ON "journeys" USING btree ("invite_code");
