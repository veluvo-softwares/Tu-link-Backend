import { Injectable, Logger } from '@nestjs/common';
import type {
  OrganizationJSON,
  OrganizationMembershipJSON,
  WebhookEvent,
} from '@clerk/backend';
import { ClerkOrganizationsRepository } from '../../database/repositories/clerk-organizations.repository';

@Injectable()
export class ClerkWebhooksService {
  private readonly logger = new Logger(ClerkWebhooksService.name);

  constructor(
    private readonly clerkOrganizationsRepository: ClerkOrganizationsRepository,
  ) {}

  async handleEvent(evt: WebhookEvent): Promise<void> {
    switch (evt.type) {
      case 'organization.created':
      case 'organization.updated':
        await this.handleOrganizationUpsert(evt.data);
        return;
      case 'organization.deleted':
        if (!evt.data.id) {
          this.logger.warn('Received organization.deleted without an org id');
          return;
        }
        await this.clerkOrganizationsRepository.deleteOrganizationByClerkOrgId(
          evt.data.id,
        );
        this.logger.log(`Deleted Clerk organization ${evt.data.id}`);
        return;
      case 'organizationMembership.created':
      case 'organizationMembership.updated':
        await this.handleMembershipUpsert(evt.data);
        return;
      case 'organizationMembership.deleted':
        await this.handleMembershipDelete(evt.data);
        return;
      default:
        return;
    }
  }

  private async handleOrganizationUpsert(data: OrganizationJSON) {
    await this.clerkOrganizationsRepository.upsertOrganization({
      clerkOrgId: data.id,
      name: data.name,
    });
    this.logger.log(`Upserted Clerk organization ${data.id}`);
  }

  private async handleMembershipUpsert(data: OrganizationMembershipJSON) {
    const organization =
      await this.clerkOrganizationsRepository.upsertOrganization({
        clerkOrgId: data.organization.id,
        name: data.organization.name,
      });

    await this.clerkOrganizationsRepository.upsertMembership({
      organizationId: organization.id,
      clerkUserId: data.public_user_data.user_id,
      role: data.role,
      status: 'active',
    });

    this.logger.log(
      `Upserted Clerk membership for user ${data.public_user_data.user_id} in org ${data.organization.id}`,
    );
  }

  private async handleMembershipDelete(data: OrganizationMembershipJSON) {
    const organization =
      await this.clerkOrganizationsRepository.findOrganizationByClerkOrgId(
        data.organization.id,
      );

    if (!organization) {
      this.logger.warn(
        `Skipping membership delete for unknown Clerk organization ${data.organization.id}`,
      );
      return;
    }

    await this.clerkOrganizationsRepository.markMembershipInactive(
      organization.id,
      data.public_user_data.user_id,
    );
    this.logger.log(
      `Marked membership inactive for user ${data.public_user_data.user_id} in org ${data.organization.id}`,
    );
  }
}
