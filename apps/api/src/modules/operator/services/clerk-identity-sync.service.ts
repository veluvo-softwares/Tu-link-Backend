import { Injectable, Logger } from '@nestjs/common';
import { getClerkClient } from '../../../shared/clerk/clerk.client';
import { ClerkOrganizationsRepository } from '../../../database/repositories/clerk-organizations.repository';

export interface ClerkSyncedOrganization {
  clerkOrgId: string;
  name: string;
  localOrganizationId: string;
  membershipId: string;
  role: string;
  status: string;
}

export interface ClerkSyncResult {
  userId: string;
  activeOrganizationId: string | null;
  organizationCount: number;
  organizations: ClerkSyncedOrganization[];
}

@Injectable()
export class ClerkIdentitySyncService {
  private readonly logger = new Logger(ClerkIdentitySyncService.name);

  constructor(
    private readonly clerkOrganizationsRepository: ClerkOrganizationsRepository,
  ) {}

  async syncUserOrganizations(
    userId: string,
    activeClerkOrgId: string | null = null,
  ): Promise<ClerkSyncResult> {
    const clerkClient = getClerkClient();
    const memberships = await this.fetchAllMemberships(clerkClient, userId);
    const organizations: ClerkSyncedOrganization[] = [];
    const activeOrganizationIds: string[] = [];

    for (const membership of memberships) {
      const organization =
        await this.clerkOrganizationsRepository.upsertOrganization({
          clerkOrgId: membership.organization.id,
          name: membership.organization.name,
        });

      const storedMembership =
        await this.clerkOrganizationsRepository.upsertMembership({
          organizationId: organization.id,
          clerkUserId: userId,
          role: membership.role,
          status: 'active',
        });

      activeOrganizationIds.push(organization.id);
      organizations.push({
        clerkOrgId: organization.clerkOrgId,
        name: organization.name,
        localOrganizationId: organization.id,
        membershipId: storedMembership.id,
        role: storedMembership.role,
        status: storedMembership.status,
      });
    }

    await this.clerkOrganizationsRepository.markMissingMembershipsInactive(
      userId,
      activeOrganizationIds,
    );

    this.logger.log(
      `Synced ${organizations.length} Clerk organization memberships for user ${userId}`,
    );

    return {
      userId,
      activeOrganizationId:
        activeClerkOrgId ?? memberships[0]?.organization.id ?? null,
      organizationCount: organizations.length,
      organizations,
    };
  }

  private async fetchAllMemberships(
    clerkClient: ReturnType<typeof getClerkClient>,
    userId: string,
  ) {
    const memberships: Awaited<
      ReturnType<typeof clerkClient.users.getOrganizationMembershipList>
    >['data'] = [];
    const limit = 100;
    let offset = 0;
    let totalCount = Number.POSITIVE_INFINITY;

    while (offset < totalCount) {
      const page = await clerkClient.users.getOrganizationMembershipList({
        userId,
        limit,
        offset,
      });

      memberships.push(...page.data);
      totalCount = page.totalCount;
      offset += page.data.length;

      if (page.data.length === 0) {
        break;
      }
    }

    return memberships;
  }
}
