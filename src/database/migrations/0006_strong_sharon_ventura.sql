DROP INDEX "idx_journeys_one_active_per_leader";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_journeys_one_open_per_leader" ON "journeys" USING btree ("leader_id") WHERE status IN ('PENDING', 'ACTIVE');--> statement-breakpoint
UPDATE "participants"
SET
  "status" = 'LEFT',
  "left_at" = COALESCE("left_at", now()),
  "connection_status" = 'DISCONNECTED'
WHERE "status" IN ('ACCEPTED', 'ACTIVE', 'ARRIVED')
  AND "journey_id" IN (
    SELECT "id"
    FROM "journeys"
    WHERE "status" IN ('COMPLETED', 'CANCELLED')
  );--> statement-breakpoint
CREATE UNIQUE INDEX "idx_participants_one_open_membership" ON "participants" USING btree ("user_id") WHERE status IN ('ACCEPTED', 'ACTIVE', 'ARRIVED');
