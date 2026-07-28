import { Injectable } from '@nestjs/common';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database.service';
import {
  organizationMemberships,
  organizations,
  type OrganizationMembershipRow,
  type OrganizationRow,
} from '../schema';

export interface UpsertClerkOrganizationInput {
  clerkOrgId: string;
  name: string;
}

export interface UpsertClerkMembershipInput {
  organizationId: string;
  clerkUserId: string;
  role: string;
  status?: string;
}

@Injectable()
export class ClerkOrganizationsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  async upsertOrganization(
    input: UpsertClerkOrganizationInput,
  ): Promise<OrganizationRow> {
    const [row] = await this.db
      .insert(organizations)
      .values({
        clerkOrgId: input.clerkOrgId,
        name: input.name,
      })
      .onConflictDoUpdate({
        target: organizations.clerkOrgId,
        set: {
          name: input.name,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    return row;
  }

  async upsertMembership(
    input: UpsertClerkMembershipInput,
  ): Promise<OrganizationMembershipRow> {
    const [row] = await this.db
      .insert(organizationMemberships)
      .values({
        organizationId: input.organizationId,
        clerkUserId: input.clerkUserId,
        role: input.role,
        status: input.status ?? 'active',
      })
      .onConflictDoUpdate({
        target: [
          organizationMemberships.organizationId,
          organizationMemberships.clerkUserId,
        ],
        set: {
          role: input.role,
          status: input.status ?? 'active',
          updatedAt: sql`now()`,
        },
      })
      .returning();

    return row;
  }

  async markMissingMembershipsInactive(
    clerkUserId: string,
    activeOrganizationIds: string[],
  ): Promise<void> {
    const whereClause =
      activeOrganizationIds.length > 0
        ? and(
            eq(organizationMemberships.clerkUserId, clerkUserId),
            notInArray(
              organizationMemberships.organizationId,
              activeOrganizationIds,
            ),
          )
        : eq(organizationMemberships.clerkUserId, clerkUserId);

    await this.db
      .update(organizationMemberships)
      .set({ status: 'inactive', updatedAt: sql`now()` })
      .where(whereClause);
  }

  async findOrganizationByClerkOrgId(
    clerkOrgId: string,
  ): Promise<OrganizationRow | null> {
    const [row] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.clerkOrgId, clerkOrgId))
      .limit(1);
    return row ?? null;
  }

  async deleteOrganizationByClerkOrgId(clerkOrgId: string): Promise<void> {
    await this.db
      .delete(organizations)
      .where(eq(organizations.clerkOrgId, clerkOrgId));
  }

  async markMembershipInactive(
    organizationId: string,
    clerkUserId: string,
  ): Promise<void> {
    await this.db
      .update(organizationMemberships)
      .set({ status: 'inactive', updatedAt: sql`now()` })
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.clerkUserId, clerkUserId),
        ),
      );
  }
}
