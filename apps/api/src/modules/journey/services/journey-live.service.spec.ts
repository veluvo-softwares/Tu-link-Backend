import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { JourneyLiveService } from './journey-live.service';

describe('JourneyLiveService', () => {
  const journeyId = '11111111-1111-4111-8111-111111111111';
  const now = new Date('2026-08-29T12:00:00Z');

  let service: JourneyLiveService;
  let journeyRepository: { findById: jest.Mock };
  let participantService: {
    isParticipant: jest.Mock;
    getJourneyParticipants: jest.Mock;
  };
  let locationService: {
    getLatestLocationsForAuthorizedViewer: jest.Mock;
  };
  let routeRepository: { findCurrent: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    journeyRepository = {
      findById: jest.fn().mockResolvedValue({
        id: journeyId,
        name: 'Nairobi convoy',
        leaderId: 'leader-1',
        status: 'ACTIVE',
        destination: { latitude: -1.3, longitude: 36.8 },
        destinationName: 'Destination',
        destinationAddress: 'Nairobi',
        startTime: new Date('2026-08-29T11:00:00Z'),
        endTime: null,
        lagThresholdMeters: 500,
      }),
    };
    participantService = {
      isParticipant: jest.fn().mockResolvedValue(true),
      getJourneyParticipants: jest.fn().mockResolvedValue([
        {
          userId: 'leader-1',
          displayName: 'Leader',
          role: 'LEADER',
          status: 'ACTIVE',
          connectionStatus: 'CONNECTED',
          lastSeenAt: new Date(now.getTime() - 3000),
        },
        {
          userId: 'follower-1',
          displayName: 'Follower',
          role: 'FOLLOWER',
          status: 'ACTIVE',
          connectionStatus: 'RECONNECTING',
        },
        {
          userId: 'arrived-1',
          displayName: 'Arrived',
          role: 'FOLLOWER',
          status: 'ARRIVED',
          connectionStatus: 'DISCONNECTED',
          arrivedAt: new Date(now.getTime() - 60000),
        },
        {
          userId: 'invited-1',
          role: 'FOLLOWER',
          status: 'INVITED',
          connectionStatus: 'DISCONNECTED',
        },
      ]),
    };
    locationService = {
      getLatestLocationsForAuthorizedViewer: jest.fn().mockResolvedValue({
        participants: {
          'leader-1': {
            journeyId,
            participantId: 'leader-1',
            location: { latitude: -1.2, longitude: 36.7 },
            accuracy: 5,
            timestamp: now.getTime() - 5000,
            sequenceNumber: 12,
          },
          'follower-1': {
            journeyId,
            participantId: 'follower-1',
            location: { latitude: -1.21, longitude: 36.71 },
            accuracy: 8,
            timestamp: now.getTime() - 30000,
            sequenceNumber: 15,
          },
        },
      }),
    };
    routeRepository = {
      findCurrent: jest.fn().mockResolvedValue({
        journeyId,
        version: 3,
        coordinates: [[36.7, -1.2]],
      }),
    };

    service = new JourneyLiveService(
      journeyRepository as never,
      participantService as never,
      locationService as never,
      routeRepository as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('returns a route-versioned snapshot with roster and freshness', async () => {
    const snapshot = await service.getSnapshot(journeyId, 'follower-1');

    expect(snapshot.route).toMatchObject({ version: 3 });
    expect(snapshot.cursor).toEqual({ locationSequence: 15 });
    expect(snapshot.generatedAt).toBe(now.toISOString());
    expect(snapshot.members).toHaveLength(3);
    expect(snapshot.members[0]).toMatchObject({
      userId: 'leader-1',
      locationAgeSeconds: 5,
      locationState: 'LIVE',
    });
    expect(snapshot.members[1]).toMatchObject({
      userId: 'follower-1',
      locationAgeSeconds: 30,
      locationState: 'DELAYED',
    });
    expect(snapshot.members[2]).toMatchObject({
      userId: 'arrived-1',
      location: null,
      lastLocationAt: null,
      locationState: 'UNKNOWN',
    });
    expect(
      snapshot.members.some((member) => member.userId === 'invited-1'),
    ).toBe(false);
  });

  it('classifies a location older than sixty seconds as stale', async () => {
    locationService.getLatestLocationsForAuthorizedViewer.mockResolvedValue({
      participants: {
        'leader-1': {
          journeyId,
          participantId: 'leader-1',
          location: { latitude: -1.2, longitude: 36.7 },
          accuracy: 5,
          timestamp: now.getTime() - 61000,
          sequenceNumber: 12,
        },
      },
    });

    const snapshot = await service.getSnapshot(journeyId, 'leader-1');
    expect(snapshot.members[0].locationState).toBe('STALE');
  });

  it('rejects a viewer who is not a participant', async () => {
    participantService.isParticipant.mockResolvedValue(false);

    await expect(
      service.getSnapshot(journeyId, 'outsider'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      locationService.getLatestLocationsForAuthorizedViewer,
    ).not.toHaveBeenCalled();
  });

  it('returns not found before revealing membership details', async () => {
    journeyRepository.findById.mockResolvedValue(null);

    await expect(
      service.getSnapshot(journeyId, 'leader-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(participantService.isParticipant).not.toHaveBeenCalled();
  });
});
