import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OperatorAccessService } from './operator-access.service';

describe('OperatorAccessService', () => {
  const adminAccess = {
    organizationId: 'org-local',
    clerkOrgId: 'org_clerk',
    membershipId: 'membership-admin',
    role: 'org:admin',
    canManage: true,
    visibleUserIds: null,
  };

  let service: OperatorAccessService;
  let organizationAccessRepository: {
    getAccess: jest.Mock;
    listTeamMembers: jest.Mock;
    listTeamMemberDelegations: jest.Mock;
    upsertTeamMember: jest.Mock;
    removeTeamMember: jest.Mock;
    assignDelegate: jest.Mock;
    removeDelegate: jest.Mock;
  };
  let journeyRepository: {
    findByOrganization: jest.Mock;
    findVisibleByOrganization: jest.Mock;
  };
  let usersRepository: { findById: jest.Mock; search: jest.Mock };
  let locationService: { getLatestLocationsForAuthorizedViewer: jest.Mock };

  beforeEach(() => {
    organizationAccessRepository = {
      getAccess: jest.fn().mockResolvedValue(adminAccess),
      listTeamMembers: jest.fn().mockResolvedValue([]),
      listTeamMemberDelegations: jest.fn().mockResolvedValue([]),
      upsertTeamMember: jest.fn(),
      removeTeamMember: jest.fn(),
      assignDelegate: jest.fn(),
      removeDelegate: jest.fn(),
    };
    journeyRepository = {
      findByOrganization: jest.fn().mockResolvedValue([]),
      findVisibleByOrganization: jest.fn().mockResolvedValue(null),
    };
    usersRepository = {
      findById: jest.fn(),
      search: jest.fn().mockResolvedValue([]),
    };
    locationService = {
      getLatestLocationsForAuthorizedViewer: jest.fn(),
    };
    service = new OperatorAccessService(
      organizationAccessRepository as never,
      journeyRepository as never,
      usersRepository as never,
      locationService as never,
    );
  });

  it('gives organization admins visibility across the organization', async () => {
    await service.listJourneys('org_clerk', 'user_admin');

    expect(journeyRepository.findByOrganization).toHaveBeenCalledWith(
      'org-local',
      undefined,
    );
  });

  it('restricts delegated members to their assigned Flutter users', async () => {
    organizationAccessRepository.getAccess.mockResolvedValue({
      ...adminAccess,
      role: 'org:member',
      canManage: false,
      visibleUserIds: ['firebase-user-1', 'firebase-user-2'],
    });

    await service.listJourneys('org_clerk', 'user_delegate');

    expect(journeyRepository.findByOrganization).toHaveBeenCalledWith(
      'org-local',
      ['firebase-user-1', 'firebase-user-2'],
    );
  });

  it('rejects users without an active backend membership', async () => {
    organizationAccessRepository.getAccess.mockResolvedValue(null);

    await expect(
      service.listJourneys('org_clerk', 'unknown-user'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns live locations only for a visible journey', async () => {
    journeyRepository.findVisibleByOrganization.mockResolvedValue({
      id: 'journey-visible',
    });
    locationService.getLatestLocationsForAuthorizedViewer.mockResolvedValue({
      participants: {},
    });

    await expect(
      service.getJourneyLocations('org_clerk', 'user_admin', 'journey-visible'),
    ).resolves.toEqual({ participants: {} });
  });

  it('does not reveal locations for an invisible journey', async () => {
    journeyRepository.findVisibleByOrganization.mockResolvedValue(null);

    await expect(
      service.getJourneyLocations('org_clerk', 'user_admin', 'journey-hidden'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('builds a named location feed from active visible journeys', async () => {
    journeyRepository.findByOrganization.mockResolvedValue([
      { id: 'journey-live', status: 'ACTIVE' },
      { id: 'journey-complete', status: 'COMPLETED' },
    ]);
    organizationAccessRepository.listTeamMembers.mockResolvedValue([
      { id: 'member-1', userId: 'firebase-user-1', displayName: 'Amina' },
    ]);
    locationService.getLatestLocationsForAuthorizedViewer.mockResolvedValue({
      participants: {
        'firebase-user-1': {
          location: { latitude: -1.28, longitude: 36.82 },
        },
      },
    });

    const result = await service.listLiveJourneyLocations(
      'org_clerk',
      'user_admin',
    );

    expect(result).toHaveLength(1);
    const firstResult = result[0] as unknown as {
      snapshot: {
        participants: Record<string, { displayName: string }>;
      };
    };
    expect(firstResult.snapshot.participants['firebase-user-1']).toEqual(
      expect.objectContaining({ displayName: 'Amina' }),
    );
  });

  it('prevents delegated members from managing the team', async () => {
    organizationAccessRepository.getAccess.mockResolvedValue({
      ...adminAccess,
      role: 'org:member',
      canManage: false,
      visibleUserIds: [],
    });

    await expect(
      service.addTeamMember('org_clerk', 'user_delegate', 'firebase-user'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('adds delegation identities to visible team members', async () => {
    organizationAccessRepository.listTeamMembers.mockResolvedValue([
      { id: 'team-member-1', userId: 'firebase-user-1' },
    ]);
    organizationAccessRepository.listTeamMemberDelegations.mockResolvedValue([
      {
        teamMemberId: 'team-member-1',
        clerkUserId: 'clerk-delegate-1',
      },
    ]);

    await expect(
      service.listTeamMembers('org_clerk', 'user_admin'),
    ).resolves.toEqual([
      {
        id: 'team-member-1',
        userId: 'firebase-user-1',
        delegateClerkUserIds: ['clerk-delegate-1'],
      },
    ]);
  });

  it('requires an existing delegation before removing access', async () => {
    organizationAccessRepository.removeDelegate.mockResolvedValue(null);

    await expect(
      service.removeDelegate(
        'org_clerk',
        'user_admin',
        'team-member-1',
        'clerk-delegate-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires a real Tulink user before adding a team member', async () => {
    usersRepository.findById.mockResolvedValue(null);

    await expect(
      service.addTeamMember('org_clerk', 'user_admin', 'missing-user'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not search for one-character queries', async () => {
    await expect(
      service.searchUsers('org_clerk', 'user_admin', 'a'),
    ).resolves.toEqual([]);
    expect(usersRepository.search).not.toHaveBeenCalled();
  });

  it('removes phone numbers from operator search results', async () => {
    usersRepository.search.mockResolvedValue([
      {
        uid: 'firebase-user',
        email: 'member@example.com',
        displayName: 'Member',
        phoneNumber: '+254700000000',
      },
    ]);

    await expect(
      service.searchUsers('org_clerk', 'user_admin', 'member'),
    ).resolves.toEqual([
      {
        uid: 'firebase-user',
        email: 'member@example.com',
        displayName: 'Member',
      },
    ]);
  });

  it('requires an active team member before removing one', async () => {
    organizationAccessRepository.removeTeamMember.mockResolvedValue(null);

    await expect(
      service.removeTeamMember('org_clerk', 'user_admin', 'team-member-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not move a Tulink user out of another organization', async () => {
    usersRepository.findById.mockResolvedValue({ id: 'firebase-user' });
    organizationAccessRepository.upsertTeamMember.mockResolvedValue({
      id: 'team-member',
      organizationId: 'different-org',
    });

    await expect(
      service.addTeamMember('org_clerk', 'user_admin', 'firebase-user'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
