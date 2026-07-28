import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database.service';
import {
  organizationMemberDelegations,
  organizationMemberships,
  organizations,
  organizationTeamMembers,
  users,
} from '../schema';

export interface OrganizationAccess {
  organizationId: string;
  clerkOrgId: string;
  membershipId: string;
  role: string;
  canManage: boolean;
  visibleUserIds: string[] | null;
}

@Injectable()
export class OrganizationAccessRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  async getAccess(
    clerkOrgId: string,
    clerkUserId: string,
  ): Promise<OrganizationAccess | null> {
    const [membership] = await this.db
      .select({
        organizationId: organizations.id,
        clerkOrgId: organizations.clerkOrgId,
        membershipId: organizationMemberships.id,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(
        organizations,
        eq(organizationMemberships.organizationId, organizations.id),
      )
      .where(
        and(
          eq(organizations.clerkOrgId, clerkOrgId),
          eq(organizationMemberships.clerkUserId, clerkUserId),
          eq(organizationMemberships.status, 'active'),
        ),
      )
      .limit(1);

    if (!membership) return null;

    const canManage = ['org:admin', 'admin', 'owner'].includes(membership.role);
    if (canManage) {
      return { ...membership, canManage, visibleUserIds: null };
    }

    const assignments = await this.db
      .select({ userId: organizationTeamMembers.userId })
      .from(organizationMemberDelegations)
      .innerJoin(
        organizationTeamMembers,
        eq(
          organizationMemberDelegations.teamMemberId,
          organizationTeamMembers.id,
        ),
      )
      .where(
        and(
          eq(
            organizationMemberDelegations.organizationMembershipId,
            membership.membershipId,
          ),
          eq(organizationTeamMembers.organizationId, membership.organizationId),
          eq(organizationTeamMembers.status, 'active'),
        ),
      );

    return {
      ...membership,
      canManage,
      visibleUserIds: assignments.map((assignment) => assignment.userId),
    };
  }

  async findOrganizationForUser(userId: string): Promise<string | null> {
    const [membership] = await this.db
      .select({ organizationId: organizationTeamMembers.organizationId })
      .from(organizationTeamMembers)
      .where(
        and(
          eq(organizationTeamMembers.userId, userId),
          eq(organizationTeamMembers.status, 'active'),
        ),
      )
      .limit(1);
    return membership?.organizationId ?? null;
  }

  async upsertTeamMember(
    organizationId: string,
    userId: string,
    createdByClerkUserId: string,
  ) {
    const [inserted] = await this.db
      .insert(organizationTeamMembers)
      .values({ organizationId, userId, createdByClerkUserId })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;

    const [existing] = await this.db
      .select()
      .from(organizationTeamMembers)
      .where(eq(organizationTeamMembers.userId, userId))
      .limit(1);
    if (!existing || existing.organizationId !== organizationId) {
      return existing ?? null;
    }

    const [reactivated] = await this.db
      .update(organizationTeamMembers)
      .set({
        status: 'active',
        createdByClerkUserId,
        updatedAt: sql`now()`,
      })
      .where(eq(organizationTeamMembers.id, existing.id))
      .returning();
    return reactivated;
  }

  async listTeamMembers(organizationId: string, visibleUserIds?: string[]) {
    if (visibleUserIds && visibleUserIds.length === 0) return [];

    const where = visibleUserIds
      ? and(
          eq(organizationTeamMembers.organizationId, organizationId),
          eq(organizationTeamMembers.status, 'active'),
          inArray(organizationTeamMembers.userId, visibleUserIds),
        )
      : and(
          eq(organizationTeamMembers.organizationId, organizationId),
          eq(organizationTeamMembers.status, 'active'),
        );

    return this.db
      .select({
        id: organizationTeamMembers.id,
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        status: organizationTeamMembers.status,
        createdAt: organizationTeamMembers.createdAt,
      })
      .from(organizationTeamMembers)
      .innerJoin(users, eq(organizationTeamMembers.userId, users.id))
      .where(where);
  }

  async assignDelegate(
    organizationId: string,
    clerkUserId: string,
    teamMemberId: string,
  ) {
    const [membership] = await this.db
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.clerkUserId, clerkUserId),
          eq(organizationMemberships.status, 'active'),
        ),
      )
      .limit(1);
    if (!membership) return null;

    const [teamMember] = await this.db
      .select({ id: organizationTeamMembers.id })
      .from(organizationTeamMembers)
      .where(
        and(
          eq(organizationTeamMembers.id, teamMemberId),
          eq(organizationTeamMembers.organizationId, organizationId),
          eq(organizationTeamMembers.status, 'active'),
        ),
      )
      .limit(1);
    if (!teamMember) return null;

    const [delegation] = await this.db
      .insert(organizationMemberDelegations)
      .values({
        organizationMembershipId: membership.id,
        teamMemberId: teamMember.id,
      })
      .onConflictDoNothing()
      .returning();
    return (
      delegation ?? { organizationMembershipId: membership.id, teamMemberId }
    );
  }
}
