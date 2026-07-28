import { BadRequestException, ConflictException } from '@nestjs/common';
import { JourneyService } from './journey.service';

describe('JourneyService — single open journey lifecycle', () => {
  const userId = 'user-1';
  const targetJourneyId = 'journey-target';
  const otherJourneyId = 'journey-other';

  const journey = (id: string, status: 'PENDING' | 'ACTIVE' | 'COMPLETED') =>
    ({
      id,
      name: `Journey ${id}`,
      leaderId: 'leader-1',
      status,
      destination: { latitude: 0, longitude: 0 },
      destinationAddress: 'Destination',
      lagThresholdMeters: 500,
    }) as never;

  let service: JourneyService;
  let journeyRepository: {
    create: jest.Mock;
    findById: jest.Mock;
    findByInviteCode: jest.Mock;
    updateStatus: jest.Mock;
  };
  let participantService: {
    getUserParticipations: jest.Mock;
    getParticipant: jest.Mock;
    acceptInvitation: jest.Mock;
    markActive: jest.Mock;
    addParticipant: jest.Mock;
    getJourneyParticipants: jest.Mock;
    releaseJoinedMemberships: jest.Mock;
    joinWithCode: jest.Mock;
    isParticipant: jest.Mock;
  };

  beforeEach(() => {
    journeyRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByInviteCode: jest.fn(),
      updateStatus: jest.fn(),
    };
    participantService = {
      getUserParticipations: jest.fn().mockResolvedValue([]),
      getParticipant: jest.fn(),
      acceptInvitation: jest.fn().mockResolvedValue(undefined),
      markActive: jest.fn().mockResolvedValue(undefined),
      addParticipant: jest.fn().mockResolvedValue(undefined),
      getJourneyParticipants: jest.fn().mockResolvedValue([]),
      releaseJoinedMemberships: jest.fn().mockResolvedValue(undefined),
      joinWithCode: jest.fn().mockResolvedValue(undefined),
      isParticipant: jest.fn().mockResolvedValue(true),
    };

    service = new JourneyService(
      journeyRepository as never,
      {
        findById: jest.fn().mockResolvedValue({ displayName: 'Driver' }),
      } as never,
      {
        addJourneyParticipant: jest.fn(),
        getJourneyParticipants: jest.fn().mockResolvedValue([]),
        clearJourneyCache: jest.fn(),
        getClient: jest.fn().mockReturnValue({ del: jest.fn() }),
      } as never,
      {} as never,
      participantService as never,
      {
        resolveParticipantRecipients: jest.fn().mockReturnValue([]),
        sendParticipantJoined: jest.fn(),
        sendJourneyCancelled: jest.fn().mockResolvedValue(undefined),
      } as never,
      { get: jest.fn() } as never,
      {} as never,
      {
        broadcastParticipantAccepted: jest.fn().mockResolvedValue(undefined),
        broadcastJourneyEnded: jest.fn().mockResolvedValue(undefined),
      } as never,
      { error: jest.fn(), warn: jest.fn() } as never,
    );
  });

  it('returns pending memberships from the open-journeys endpoint', async () => {
    participantService.getUserParticipations.mockResolvedValue([
      { journeyId: targetJourneyId },
      { journeyId: otherJourneyId },
    ]);
    journeyRepository.findById.mockImplementation((id: string) =>
      Promise.resolve(
        id === targetJourneyId
          ? journey(targetJourneyId, 'PENDING')
          : journey(otherJourneyId, 'COMPLETED'),
      ),
    );

    await expect(service.getUserActiveJourneys(userId)).resolves.toEqual([
      expect.objectContaining({ id: targetJourneyId, status: 'PENDING' }),
    ]);
    expect(participantService.getUserParticipations).toHaveBeenCalledWith(
      userId,
      ['ACTIVE', 'ACCEPTED', 'ARRIVED'],
    );
  });

  it('rejects journey creation when the user already has an open journey', async () => {
    participantService.getUserParticipations.mockResolvedValue([
      { journeyId: otherJourneyId },
    ]);
    journeyRepository.findById.mockResolvedValue(
      journey(otherJourneyId, 'PENDING'),
    );

    await expect(
      service.create(userId, {
        name: 'Second journey',
        destination: { latitude: 0, longitude: 0 },
        destinationAddress: 'Destination',
        lagThresholdMeters: 500,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(journeyRepository.create).not.toHaveBeenCalled();
  });

  it('maps a raced database uniqueness failure to the open-journey conflict', async () => {
    journeyRepository.create.mockRejectedValue({ cause: { code: '23505' } });

    await expect(
      service.create(userId, {
        name: 'Raced journey',
        destination: { latitude: 0, longitude: 0 },
        destinationAddress: 'Destination',
        lagThresholdMeters: 500,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancels a newly created row if concurrent invite acceptance wins', async () => {
    journeyRepository.create.mockResolvedValue(
      journey(targetJourneyId, 'PENDING'),
    );
    participantService.addParticipant.mockRejectedValue({ code: '23505' });

    await expect(
      service.create(userId, {
        name: 'Raced journey',
        destination: { latitude: 0, longitude: 0 },
        destinationAddress: 'Destination',
        lagThresholdMeters: 500,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(journeyRepository.updateStatus).toHaveBeenCalledWith(
      targetJourneyId,
      'CANCELLED',
      { setEndTime: true },
    );
  });

  it('rejects accepting an invite when the user belongs to another open journey', async () => {
    journeyRepository.findById.mockImplementation((id: string) =>
      Promise.resolve(
        id === targetJourneyId
          ? journey(targetJourneyId, 'PENDING')
          : journey(otherJourneyId, 'ACTIVE'),
      ),
    );
    participantService.getParticipant.mockResolvedValue({ status: 'INVITED' });
    participantService.getUserParticipations.mockResolvedValue([
      { journeyId: otherJourneyId },
    ]);

    await expect(
      service.acceptInvitation(targetJourneyId, userId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(participantService.acceptInvitation).not.toHaveBeenCalled();
  });

  it('allows an invited user with no other open journey to accept', async () => {
    journeyRepository.findById.mockResolvedValue(
      journey(targetJourneyId, 'PENDING'),
    );
    participantService.getParticipant.mockResolvedValue({ status: 'INVITED' });

    await service.acceptInvitation(targetJourneyId, userId);

    expect(participantService.acceptInvitation).toHaveBeenCalledWith(
      targetJourneyId,
      userId,
    );
  });

  it('only allows leaders to cancel pending journeys', async () => {
    journeyRepository.findById.mockResolvedValue({
      id: targetJourneyId,
      name: 'Completed journey',
      leaderId: userId,
      status: 'COMPLETED',
    });

    await expect(
      service.delete(targetJourneyId, userId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(journeyRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('admits a code join to a pending journey as accepted', async () => {
    journeyRepository.findByInviteCode.mockResolvedValue(
      journey(targetJourneyId, 'PENDING'),
    );
    journeyRepository.findById.mockResolvedValue(
      journey(targetJourneyId, 'PENDING'),
    );
    participantService.getParticipant.mockResolvedValue(null);

    await expect(service.joinWithCode('abcd234567', userId)).resolves.toEqual(
      expect.objectContaining({ id: targetJourneyId }),
    );

    expect(journeyRepository.findByInviteCode).toHaveBeenCalledWith(
      'ABCD234567',
    );
    expect(participantService.joinWithCode).toHaveBeenCalledWith(
      targetJourneyId,
      userId,
      'leader-1',
      'ACCEPTED',
    );
  });

  it('admits a code join to a live journey as active', async () => {
    journeyRepository.findByInviteCode.mockResolvedValue(
      journey(targetJourneyId, 'ACTIVE'),
    );
    journeyRepository.findById.mockResolvedValue(
      journey(targetJourneyId, 'ACTIVE'),
    );
    participantService.getParticipant.mockResolvedValue(null);

    await service.joinWithCode('ABCD234567', userId);

    expect(participantService.joinWithCode).toHaveBeenCalledWith(
      targetJourneyId,
      userId,
      'leader-1',
      'ACTIVE',
    );
  });

  it('rejects a code join after the journey has completed', async () => {
    journeyRepository.findByInviteCode.mockResolvedValue(
      journey(targetJourneyId, 'COMPLETED'),
    );

    await expect(
      service.joinWithCode('ABCD234567', userId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(participantService.joinWithCode).not.toHaveBeenCalled();
  });

  it('rejects a code join when the user belongs to another open journey', async () => {
    journeyRepository.findByInviteCode.mockResolvedValue(
      journey(targetJourneyId, 'PENDING'),
    );
    journeyRepository.findById.mockResolvedValue(
      journey(otherJourneyId, 'ACTIVE'),
    );
    participantService.getParticipant.mockResolvedValue(null);
    participantService.getUserParticipations.mockResolvedValue([
      { journeyId: otherJourneyId },
    ]);

    await expect(
      service.joinWithCode('ABCD234567', userId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(participantService.joinWithCode).not.toHaveBeenCalled();
  });
});
