DROP INDEX "idx_journeys_one_active_per_leader";--> statement-breakpoint
WITH "ranked_open_journeys" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "leader_id"
      ORDER BY
        CASE "status" WHEN 'ACTIVE' THEN 0 ELSE 1 END,
        "created_at" DESC,
        "id" DESC
    ) AS "open_rank"
  FROM "journeys"
  WHERE "status" IN ('PENDING', 'ACTIVE')
)
UPDATE "journeys"
SET
  "status" = 'CANCELLED',
  "end_time" = COALESCE("end_time", now()),
  "updated_at" = now()
FROM "ranked_open_journeys"
WHERE "journeys"."id" = "ranked_open_journeys"."id"
  AND "ranked_open_journeys"."open_rank" > 1;--> statement-breakpoint
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
WITH "ranked_open_memberships" AS (
  SELECT
    "participants"."journey_id",
    "participants"."user_id",
    row_number() OVER (
      PARTITION BY "participants"."user_id"
      ORDER BY
        CASE "journeys"."status" WHEN 'ACTIVE' THEN 0 ELSE 1 END,
        CASE "participants"."status"
          WHEN 'ARRIVED' THEN 0
          WHEN 'ACTIVE' THEN 1
          ELSE 2
        END,
        CASE "participants"."role" WHEN 'LEADER' THEN 0 ELSE 1 END,
        "participants"."joined_at" DESC NULLS LAST,
        "journeys"."created_at" DESC,
        "participants"."journey_id" DESC
    ) AS "membership_rank"
  FROM "participants"
  INNER JOIN "journeys"
    ON "journeys"."id" = "participants"."journey_id"
  WHERE "participants"."status" IN ('ACCEPTED', 'ACTIVE', 'ARRIVED')
    AND "journeys"."status" IN ('PENDING', 'ACTIVE')
)
UPDATE "participants"
SET
  "status" = 'LEFT',
  "left_at" = COALESCE("left_at", now()),
  "connection_status" = 'DISCONNECTED'
FROM "ranked_open_memberships"
WHERE "participants"."journey_id" = "ranked_open_memberships"."journey_id"
  AND "participants"."user_id" = "ranked_open_memberships"."user_id"
  AND "ranked_open_memberships"."membership_rank" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_journeys_one_open_per_leader" ON "journeys" USING btree ("leader_id") WHERE status IN ('PENDING', 'ACTIVE');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_participants_one_open_membership" ON "participants" USING btree ("user_id") WHERE status IN ('ACCEPTED', 'ACTIVE', 'ARRIVED');
