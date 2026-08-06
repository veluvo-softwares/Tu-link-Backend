import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JourneyRepository } from '../../../database/repositories/journey.repository';
import { OrganizationAccessRepository } from '../../../database/repositories/organization-access.repository';
import { UsersRepository } from '../../../database/repositories/users.repository';
import { LocationService } from '../../location/location.service';
import type {
  LatestLocationsResponse,
  LocationUpdate,
} from '../../../shared/interfaces/location.interface';

type DashboardLocationSnapshot = Omit<
  LatestLocationsResponse,
  'participants'
> & {
  participants: Record<string, LocationUpdate & { displayName: string }>;
};

@Injectable()
export class OperatorAccessService {
  constructor(
    private readonly organizationAccessRepository: OrganizationAccessRepository,
    private readonly journeyRepository: JourneyRepository,
    private readonly usersRepository: UsersRepository,
    private readonly locationService: LocationService,
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

  async getJourneyLocations(
    clerkOrgId: string,
    clerkUserId: string,
    journeyId: string,
  ) {
    const access = await this.requireAccess(clerkOrgId, clerkUserId);
    const journey = await this.journeyRepository.findVisibleByOrganization(
      journeyId,
      access.organizationId,
      access.visibleUserIds ?? undefined,
    );
    if (!journey) {
      throw new NotFoundException('Visible journey not found');
    }
    return this.locationService.getLatestLocationsForAuthorizedViewer(
      journeyId,
    );
  }

  async listLiveJourneyLocations(clerkOrgId: string, clerkUserId: string) {
    const access = await this.requireAccess(clerkOrgId, clerkUserId);
    const [journeys, teamMembers] = await Promise.all([
      this.journeyRepository.findByOrganization(
        access.organizationId,
        access.visibleUserIds ?? undefined,
      ),
      this.organizationAccessRepository.listTeamMembers(
        access.organizationId,
        access.visibleUserIds ?? undefined,
      ),
    ]);
    const namesByUserId = new Map(
      teamMembers.map((member) => [member.userId, member.displayName]),
    );

    const activeJourneys = journeys
      .filter((journey) => journey.status === 'ACTIVE')
      .slice(0, 100);
    const result: Array<{
      journey: (typeof activeJourneys)[number];
      snapshot: DashboardLocationSnapshot;
    }> = [];
    for (const journey of activeJourneys) {
      const snapshot =
        await this.locationService.getLatestLocationsForAuthorizedViewer(
          journey.id,
        );
      result.push({
        journey,
        snapshot: {
          ...snapshot,
          participants: Object.fromEntries(
            Object.entries(snapshot.participants).map(
              ([participantId, location]) => [
                participantId,
                {
                  ...location,
                  displayName:
                    namesByUserId.get(participantId) ?? 'Tulink member',
                },
              ],
            ),
          ),
        },
      });
    }
    return result;
  }

  async listTeamMembers(clerkOrgId: string, clerkUserId: string) {
    const access = await this.requireAccess(clerkOrgId, clerkUserId);
    const teamMembers = await this.organizationAccessRepository.listTeamMembers(
      access.organizationId,
      access.visibleUserIds ?? undefined,
    );
    const delegations =
      await this.organizationAccessRepository.listTeamMemberDelegations(
        access.organizationId,
        teamMembers.map((member) => member.id),
      );

    return teamMembers.map((member) => ({
      ...member,
      delegateClerkUserIds: delegations
        .filter((delegation) => delegation.teamMemberId === member.id)
        .map((delegation) => delegation.clerkUserId),
    }));
  }

  async searchUsers(clerkOrgId: string, clerkUserId: string, query: string) {
    await this.requireManager(clerkOrgId, clerkUserId);
    if (query.trim().length < 2) return [];
    const users = await this.usersRepository.search(query, 20);
    // Operators only need an identifier to assign a mobile member. Do not
    // expose phone numbers through the dashboard search response.
    return users.map(({ uid, email, displayName }) => ({
      uid,
      email,
      displayName,
    }));
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

  async removeTeamMember(
    clerkOrgId: string,
    clerkUserId: string,
    teamMemberId: string,
  ) {
    const access = await this.requireManager(clerkOrgId, clerkUserId);
    const teamMember = await this.organizationAccessRepository.removeTeamMember(
      access.organizationId,
      teamMemberId,
    );
    if (!teamMember) {
      throw new NotFoundException('Active team member not found');
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

  async removeDelegate(
    clerkOrgId: string,
    clerkUserId: string,
    teamMemberId: string,
    delegateClerkUserId: string,
  ) {
    const access = await this.requireManager(clerkOrgId, clerkUserId);
    const delegation = await this.organizationAccessRepository.removeDelegate(
      access.organizationId,
      delegateClerkUserId,
      teamMemberId,
    );
    if (!delegation) {
      throw new NotFoundException('Active delegation not found');
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
