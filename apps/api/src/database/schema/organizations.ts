import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    clerkOrgId: text('clerk_org_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('organizations_clerk_org_id_unique').on(t.clerkOrgId),
    index('idx_organizations_name').on(t.name),
  ],
);

export type OrganizationRow = typeof organizations.$inferSelect;

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clerkUserId: text('clerk_user_id').notNull(),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('organization_memberships_org_user_unique').on(
      t.organizationId,
      t.clerkUserId,
    ),
    index('idx_organization_memberships_clerk_user').on(t.clerkUserId),
    index('idx_organization_memberships_org').on(t.organizationId, t.status),
  ],
);

export type OrganizationMembershipRow =
  typeof organizationMemberships.$inferSelect;

export const organizationTeamMembers = pgTable(
  'organization_team_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('active'),
    createdByClerkUserId: text('created_by_clerk_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('organization_team_members_user_unique').on(t.userId),
    index('idx_organization_team_members_org').on(t.organizationId, t.status),
  ],
);

export type OrganizationTeamMemberRow =
  typeof organizationTeamMembers.$inferSelect;

export const organizationMemberDelegations = pgTable(
  'organization_member_delegations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationMembershipId: uuid('organization_membership_id')
      .notNull()
      .references(() => organizationMemberships.id, { onDelete: 'cascade' }),
    teamMemberId: uuid('team_member_id')
      .notNull()
      .references(() => organizationTeamMembers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('organization_member_delegations_unique').on(
      t.organizationMembershipId,
      t.teamMemberId,
    ),
    index('idx_organization_member_delegations_membership').on(
      t.organizationMembershipId,
    ),
  ],
);
