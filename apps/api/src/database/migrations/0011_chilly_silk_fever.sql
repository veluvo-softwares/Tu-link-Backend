CREATE TABLE "organization_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_team_members_user_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "organization_member_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_membership_id" uuid NOT NULL,
	"team_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_member_delegations_unique" UNIQUE("organization_membership_id","team_member_id")
);
--> statement-breakpoint
ALTER TABLE "organization_team_members" ADD CONSTRAINT "organization_team_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_team_members" ADD CONSTRAINT "organization_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_member_delegations" ADD CONSTRAINT "organization_member_delegations_organization_membership_id_organization_memberships_id_fk" FOREIGN KEY ("organization_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_member_delegations" ADD CONSTRAINT "organization_member_delegations_team_member_id_organization_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."organization_team_members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_organization_team_members_org" ON "organization_team_members" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX "idx_organization_member_delegations_membership" ON "organization_member_delegations" USING btree ("organization_membership_id");
