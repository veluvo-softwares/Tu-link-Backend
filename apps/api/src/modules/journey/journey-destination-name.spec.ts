import { JourneyService } from './journey.service';

/**
 * Contract tests for `destinationName`.
 *
 * Google Places returns a coarse `formattedAddress` ("Nairobi, Kenya") for POIs
 * whose `displayName` is specific ("Karen Shopping Centre"). The API previously
 * stored only the address, so every journey to that POI was recorded as the
 * city. The column is nullable and the field optional so clients released
 * before it existed keep working unchanged.
 */
describe('JourneyService — destinationName', () => {
  const userId = 'user-1';

  let service: JourneyService;
  let journeyRepository: {
    create: jest.Mock;
    findById: jest.Mock;
    findByInviteCode: jest.Mock;
    updateStatus: jest.Mock;
    update: jest.Mock;
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

  const createdJourney = {
    id: 'journey-1',
    name: 'Trip to Karen Shopping Centre',
    leaderId: userId,
    status: 'PENDING',
    destination: { latitude: -1.3234931, longitude: 36.7083102 },
    destinationName: 'Karen Shopping Centre',
    destinationAddress: 'Nairobi, Kenya',
    lagThresholdMeters: 500,
  };

  beforeEach(() => {
    journeyRepository = {
      create: jest.fn().mockResolvedValue(createdJourney),
      findById: jest.fn().mockResolvedValue(createdJourney),
      findByInviteCode: jest.fn(),
      updateStatus: jest.fn(),
      update: jest.fn().mockResolvedValue(createdJourney),
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
      { findOrganizationForUser: jest.fn().mockResolvedValue(null) } as never,
    );
  });

  it('persists the place name alongside the formatted address', async () => {
    await service.create(userId, {
      name: 'Trip to Karen Shopping Centre',
      destination: { latitude: -1.3234931, longitude: 36.7083102 },
      destinationName: 'Karen Shopping Centre',
      destinationAddress: 'Nairobi, Kenya',
      lagThresholdMeters: 500,
    });

    expect(journeyRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationName: 'Karen Shopping Centre',
        destinationAddress: 'Nairobi, Kenya',
      }),
    );
  });

  it('preserves coordinate order and values on create', async () => {
    await service.create(userId, {
      name: 'Trip to Karen Shopping Centre',
      destination: { latitude: -1.3234931, longitude: 36.7083102 },
      destinationName: 'Karen Shopping Centre',
      destinationAddress: 'Nairobi, Kenya',
      lagThresholdMeters: 500,
    });

    expect(journeyRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: { latitude: -1.3234931, longitude: 36.7083102 },
      }),
    );
  });

  it('accepts a payload from an older client that omits destinationName', async () => {
    await expect(
      service.create(userId, {
        name: 'Legacy trip',
        destination: { latitude: -1.2921, longitude: 36.8219 },
        destinationAddress: 'Nairobi, Kenya',
        lagThresholdMeters: 500,
      }),
    ).resolves.toBeDefined();

    expect(journeyRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationName: undefined,
        destinationAddress: 'Nairobi, Kenya',
      }),
    );
  });

  it('forwards destinationName through updates', async () => {
    journeyRepository.findById.mockResolvedValue({
      ...createdJourney,
      metadata: {},
    });

    await service.update('journey-1', userId, {
      destinationName: 'The Hub Karen',
    });

    expect(journeyRepository.update).toHaveBeenCalledWith(
      'journey-1',
      expect.objectContaining({ destinationName: 'The Hub Karen' }),
    );
  });
});
