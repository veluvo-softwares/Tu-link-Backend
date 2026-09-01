import { ConfigService } from '@nestjs/config';
import { ParticipantRepository } from '../../../database/repositories/participant.repository';
import { ArrivalDetectionService } from './arrival-detection.service';

describe('ArrivalDetectionService', () => {
  const findOne = jest.fn();
  const markArrivedIfNotArrived = jest.fn();
  const findByJourney = jest.fn();
  const participants = {
    findOne,
    markArrivedIfNotArrived,
    findByJourney,
  } as unknown as ParticipantRepository;
  const config = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key.endsWith('ImmediateDistanceThresholdMeters')) return 30;
      if (key.endsWith('DistanceThresholdMeters')) return 100;
      if (key.endsWith('SpeedThresholdMps')) return 1.39;
      return undefined;
    }),
  } as unknown as ConfigService;
  const service = new ArrivalDetectionService(participants, config);
  const journey = {
    id: 'journey-1',
    destination: { latitude: -1.2921, longitude: 36.8219 },
  } as never;

  beforeEach(() => jest.clearAllMocks());

  it('accepts a fix inside the immediate geofence despite stale speed', async () => {
    findOne.mockResolvedValue({ status: 'ACTIVE' });
    markArrivedIfNotArrived.mockResolvedValue({ status: 'ARRIVED' });
    findByJourney.mockResolvedValue([{ userId: 'user-1', status: 'ARRIVED' }]);

    const result = await service.detectArrival(
      {
        journeyId: 'journey-1',
        participantId: 'user-1',
        location: { latitude: -1.29211, longitude: 36.8219 },
        accuracy: 10,
        speed: 8,
        timestamp: Date.now(),
      },
      journey,
    );

    expect(result.arrived).toBe(true);
    expect(result.allArrived).toBe(true);
  });

  it('recomputes convergence for a participant already marked arrived', async () => {
    findOne.mockResolvedValue({ status: 'ARRIVED' });
    markArrivedIfNotArrived.mockResolvedValue(null);
    findByJourney.mockResolvedValue([
      { userId: 'user-1', status: 'ARRIVED' },
      { userId: 'user-2', status: 'ARRIVED' },
    ]);

    const result = await service.detectArrival(
      {
        journeyId: 'journey-1',
        participantId: 'user-1',
        location: { latitude: -1.29211, longitude: 36.8219 },
        accuracy: 10,
        speed: 0,
        timestamp: Date.now(),
      },
      journey,
    );

    expect(result).toMatchObject({
      arrived: false,
      alreadyArrived: true,
      arrivedCount: 2,
      totalCount: 2,
      allArrived: true,
    });
  });
});
