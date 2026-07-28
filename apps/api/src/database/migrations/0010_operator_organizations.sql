CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "clerk_org_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_clerk_org_id_unique"
  ON "organizations" ("clerk_org_id");

CREATE INDEX IF NOT EXISTS "idx_organizations_name"
  ON "organizations" ("name");

CREATE TABLE IF NOT EXISTS "organization_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "clerk_user_id" text NOT NULL,
  "role" text DEFAULT 'member' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_org_user_unique"
  ON "organization_memberships" ("organization_id", "clerk_user_id");

CREATE INDEX IF NOT EXISTS "idx_organization_memberships_clerk_user"
  ON "organization_memberships" ("clerk_user_id");

CREATE INDEX IF NOT EXISTS "idx_organization_memberships_org"
  ON "organization_memberships" ("organization_id", "status");

ALTER TABLE "journeys"
  ADD COLUMN IF NOT EXISTS "organization_id" uuid;

ALTER TABLE "journeys"
  ADD CONSTRAINT "journeys_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "idx_journeys_org"
  ON "journeys" ("organization_id", "status");
