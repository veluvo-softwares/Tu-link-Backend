CREATE TYPE "public"."journey_route_reason" AS ENUM('INITIAL', 'LEADER_REROUTE', 'MANUAL');--> statement-breakpoint
CREATE TABLE "journey_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"geometry" jsonb NOT NULL,
	"distance_metres" double precision NOT NULL,
	"duration_seconds" double precision NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" geography(Point,4326) NOT NULL,
	"destination" geography(Point,4326) NOT NULL,
	"reason" "journey_route_reason" NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journey_routes" ADD CONSTRAINT "journey_routes_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_routes" ADD CONSTRAINT "journey_routes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_journey_routes_version" ON "journey_routes" USING btree ("journey_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_journey_routes_request" ON "journey_routes" USING btree ("journey_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_journey_routes_current" ON "journey_routes" USING btree ("journey_id") WHERE is_current;--> statement-breakpoint
CREATE INDEX "idx_journey_routes_history" ON "journey_routes" USING btree ("journey_id","created_at" DESC NULLS LAST);
