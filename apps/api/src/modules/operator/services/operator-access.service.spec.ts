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
    upsertTeamMember: jest.Mock;
    assignDelegate: jest.Mock;
  };
  let journeyRepository: { findByOrganization: jest.Mock };
  let usersRepository: { findById: jest.Mock; search: jest.Mock };

  beforeEach(() => {
    organizationAccessRepository = {
      getAccess: jest.fn().mockResolvedValue(adminAccess),
      listTeamMembers: jest.fn().mockResolvedValue([]),
      upsertTeamMember: jest.fn(),
      assignDelegate: jest.fn(),
    };
    journeyRepository = {
      findByOrganization: jest.fn().mockResolvedValue([]),
    };
    usersRepository = {
      findById: jest.fn(),
      search: jest.fn().mockResolvedValue([]),
    };
    service = new OperatorAccessService(
      organizationAccessRepository as never,
      journeyRepository as never,
      usersRepository as never,
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

  it('requires a real Tulink user before adding a team member', async () => {
    usersRepository.findById.mockResolvedValue(null);

    await expect(
      service.addTeamMember('org_clerk', 'user_admin', 'missing-user'),
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
