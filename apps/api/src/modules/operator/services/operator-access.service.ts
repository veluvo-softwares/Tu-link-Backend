import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JourneyRepository } from '../../../database/repositories/journey.repository';
import { OrganizationAccessRepository } from '../../../database/repositories/organization-access.repository';
import { UsersRepository } from '../../../database/repositories/users.repository';

@Injectable()
export class OperatorAccessService {
  constructor(
    private readonly organizationAccessRepository: OrganizationAccessRepository,
    private readonly journeyRepository: JourneyRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async getSessionAccess(clerkOrgId: string, clerkUserId: string) {
    const access = await this.requireAccess(clerkOrgId, clerkUserId);
    return {
      organizationId: access.organizationId,
      clerkOrgId: access.clerkOrgId,
      role: access.role,
      canManage: access.canManage,
      scope: access.visibleUserIds === null ? 'organization' : 'delegated',
    };
  }

  async listJourneys(clerkOrgId: string, clerkUserId: string) {
    const access = await this.requireAccess(clerkOrgId, clerkUserId);
    return this.journeyRepository.findByOrganization(
      access.organizationId,
      access.visibleUserIds ?? undefined,
    );
  }

  async listTeamMembers(clerkOrgId: string, clerkUserId: string) {
    const access = await this.requireAccess(clerkOrgId, clerkUserId);
    return this.organizationAccessRepository.listTeamMembers(
      access.organizationId,
      access.visibleUserIds ?? undefined,
    );
  }

  async searchUsers(clerkOrgId: string, clerkUserId: string, query: string) {
    await this.requireManager(clerkOrgId, clerkUserId);
    if (query.trim().length < 2) return [];
    return this.usersRepository.search(query, 20);
  }

  async addTeamMember(clerkOrgId: string, clerkUserId: string, userId: string) {
    const access = await this.requireManager(clerkOrgId, clerkUserId);
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new NotFoundException('Tulink user not found');

    const teamMember = await this.organizationAccessRepository.upsertTeamMember(
      access.organizationId,
      userId,
      clerkUserId,
    );
    if (!teamMember || teamMember.organizationId !== access.organizationId) {
      throw new ConflictException(
        'Tulink user already belongs to another organization',
      );
    }
    return teamMember;
  }

  async assignDelegate(
    clerkOrgId: string,
    clerkUserId: string,
    teamMemberId: string,
    delegateClerkUserId: string,
  ) {
    const access = await this.requireManager(clerkOrgId, clerkUserId);
    const delegation = await this.organizationAccessRepository.assignDelegate(
      access.organizationId,
      delegateClerkUserId,
      teamMemberId,
    );
    if (!delegation) {
      throw new NotFoundException(
        'Active organization member or team member not found',
      );
    }
    return delegation;
  }

  private async requireManager(clerkOrgId: string, clerkUserId: string) {
    const access = await this.requireAccess(clerkOrgId, clerkUserId);
    if (!access.canManage) {
      throw new ForbiddenException('Organization admin role required');
    }
    return access;
  }

  private async requireAccess(clerkOrgId: string, clerkUserId: string) {
    const access = await this.organizationAccessRepository.getAccess(
      clerkOrgId,
      clerkUserId,
    );
    if (!access) {
      throw new ForbiddenException('Active organization membership required');
    }
    return access;
  }
}
