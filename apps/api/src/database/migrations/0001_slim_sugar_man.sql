CREATE TYPE "public"."connection_status" AS ENUM('CONNECTED', 'DISCONNECTED', 'RECONNECTING');--> statement-breakpoint
CREATE TYPE "public"."journey_status" AS ENUM('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."lag_severity" AS ENUM('WARNING', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('JOURNEY_INVITE', 'JOURNEY_STARTED', 'JOURNEY_ENDED', 'LAG_ALERT', 'PARTICIPANT_JOINED', 'PARTICIPANT_LEFT', 'ARRIVAL_DETECTED');--> statement-breakpoint
CREATE TYPE "public"."participant_role" AS ENUM('LEADER', 'FOLLOWER');--> statement-breakpoint
CREATE TYPE "public"."participant_status" AS ENUM('INVITED', 'ACCEPTED', 'DECLINED', 'ACTIVE', 'ARRIVED', 'LEFT');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TABLE "fcm_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text DEFAULT 'unknown' NOT NULL,
	"device_id" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fcm_tokens_user_id_token_unique" UNIQUE("user_id","token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"phone_number" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"is_guest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_logout" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"leader_id" text NOT NULL,
	"status" "journey_status" DEFAULT 'PENDING' NOT NULL,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"destination" geography(Point,4326),
	"destination_address" text,
	"lag_threshold_meters" integer DEFAULT 500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"journey_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "participant_role" NOT NULL,
	"status" "participant_status" NOT NULL,
	"invited_by" text,
	"connection_status" "connection_status" DEFAULT 'DISCONNECTED' NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"device_info" jsonb,
	CONSTRAINT "participants_journey_id_user_id_pk" PRIMARY KEY("journey_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "locations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"journey_id" uuid NOT NULL,
	"participant_id" text NOT NULL,
	"location" geography(Point,4326) NOT NULL,
	"accuracy" double precision,
	"heading" double precision,
	"speed" double precision,
	"altitude" double precision,
	"sequence_number" bigint,
	"priority" "priority" DEFAULT 'LOW' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lag_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid NOT NULL,
	"participant_id" text NOT NULL,
	"distance_from_leader" double precision NOT NULL,
	"leader_location" geography(Point,4326) NOT NULL,
	"follower_location" geography(Point,4326) NOT NULL,
	"severity" "lag_severity" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid NOT NULL,
	"recipient_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "journey_analytics" (
	"journey_id" uuid PRIMARY KEY NOT NULL,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"total_duration" double precision,
	"total_distance" double precision,
	"average_speed" double precision,
	"max_lag_distance" double precision,
	"lag_alert_count" integer DEFAULT 0 NOT NULL,
	"participant_count" integer DEFAULT 0 NOT NULL,
	"route_polyline" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fcm_tokens" ADD CONSTRAINT "fcm_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_journey_id_participant_id_participants_journey_id_user_id_fk" FOREIGN KEY ("journey_id","participant_id") REFERENCES "public"."participants"("journey_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lag_alerts" ADD CONSTRAINT "lag_alerts_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_analytics" ADD CONSTRAINT "journey_analytics_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_email_lower" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "idx_users_name_trgm" ON "users" USING gin ("display_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_users_email_trgm" ON "users" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_journeys_leader" ON "journeys" USING btree ("leader_id");--> statement-breakpoint
CREATE INDEX "idx_journeys_status" ON "journeys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_journeys_dest" ON "journeys" USING gist ("destination");--> statement-breakpoint
CREATE INDEX "idx_participants_user" ON "participants" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_loc_latest" ON "locations" USING btree ("journey_id","participant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_loc_seq" ON "locations" USING btree ("journey_id","sequence_number");--> statement-breakpoint
CREATE INDEX "idx_lag_active" ON "lag_alerts" USING btree ("journey_id","participant_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_notif_recipient" ON "notifications" USING btree ("recipient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_notif_unread" ON "notifications" USING btree ("recipient_id") WHERE read = false;