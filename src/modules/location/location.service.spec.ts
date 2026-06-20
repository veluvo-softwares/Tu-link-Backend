/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LocationService } from './location.service';
import { LocationRepository } from '../../database/repositories/location.repository';
import { RedisService } from '../../shared/redis/redis.service';
import { JourneyService } from '../journey/journey.service';
import { ParticipantService } from '../journey/services/participant.service';
import { AcknowledgmentService } from './services/acknowledgment.service';
import { PriorityService } from './services/priority.service';
import { SequenceService } from './services/sequence.service';
import { LagDetectionService } from './services/lag-detection.service';
import { ArrivalDetectionService } from './services/arrival-detection.service';
import { LocationUpdateDto } from './dto/location-update.dto';

describe('LocationService - Redis/Postgres', () => {
  let service: LocationService;
  let locationRepository: jest.Mocked<LocationRepository>;
  let redisService: jest.Mocked<RedisService>;
  let priorityService: jest.Mocked<PriorityService>;
  let sequenceService: jest.Mocked<SequenceService>;
  let lagDetectionService: jest.Mocked<LagDetectionService>;
  let arrivalDetectionService: jest.Mocked<ArrivalDetectionService>;

  const mockJourney = {
    id: 'journey-123',
    status: 'ACTIVE',
    leaderId: 'leader-456',
    name: 'Test Journey',
  };

  const mockParticipant = {
    id: 'participant-789',
    userId: 'user-123',
    role: 'FOLLOWER',
    status: 'ACTIVE',
  };

  const mockLocationDto: LocationUpdateDto = {
    journeyId: 'journey-123',
    location: {
      latitude: 40.7128,
      longitude: -74.006,
    },
    accuracy: 10,
    heading: 180,
    speed: 25,
    altitude: 100,
    timestamp: 1640995200000,
    metadata: {
      batteryLevel: 80,
      isMoving: true,
    },
  };

  beforeEach(async () => {
    const mockLocationRepository = {
      append: jest.fn().mockResolvedValue(undefined),
      getLatestPerParticipant: jest.fn().mockResolvedValue([]),
      getParticipantHistory: jest.fn().mockResolvedValue([]),
      getSinceSequence: jest.fn().mockResolvedValue([]),
      getLastForParticipant: jest.fn().mockResolvedValue(null),
    };

    const mockRedisClient = {
      set: jest.fn().mockResolvedValue('OK'), // NX SET: 'OK' = key absent (not a duplicate); null = key exists (duplicate, skip)
    };

    const mockRedisService = {
      getClient: jest.fn().mockReturnValue(mockRedisClient),
      checkRateLimit: jest.fn().mockResolvedValue(true),
      cacheLocation: jest.fn().mockResolvedValue(undefined),
      getCachedLocation: jest.fn().mockResolvedValue(null),
      getJourneyLeader: jest.fn().mockResolvedValue('leader-456'),
      getJourneyParticipants: jest.fn().mockResolvedValue(['participant-789']),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationService,
        {
          provide: LocationRepository,
          useValue: mockLocationRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: JourneyService,
          useValue: {
            findById: jest.fn().mockResolvedValue(mockJourney),
          },
        },
        {
          provide: ParticipantService,
          useValue: {
            getJourneyParticipants: jest.fn().mockResolvedValue([
              { ...mockParticipant, userId: 'user-123' },
              { ...mockParticipant, userId: 'user-456', id: 'participant-456' },
            ]),
            isActiveParticipant: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: PriorityService,
          useValue: {
            calculatePriority: jest.fn().mockReturnValue('MEDIUM'),
            shouldThrottle: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: SequenceService,
          useValue: {
            getNextSequence: jest.fn().mockResolvedValue(42),
          },
        },
        {
          provide: AcknowledgmentService,
          useValue: {
            requiresAcknowledgment: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: LagDetectionService,
          useValue: {
            detectLag: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ArrivalDetectionService,
          useValue: {
            detectArrival: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'app.locationUpdateRateLimit') return 60;
              if (key === 'app.locationUpdateRateWindow') return 60;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LocationService>(LocationService);
    locationRepository = module.get(LocationRepository);
    redisService = module.get(RedisService);
    priorityService = module.get(PriorityService);
    sequenceService = module.get(SequenceService);
    lagDetectionService = module.get(LagDetectionService);
    arrivalDetectionService = module.get(ArrivalDetectionService);
  });

  describe('processLocationUpdate - Redis/Firestore Behavior', () => {
    it('should await Redis cache write before method returns', async () => {
      const cacheDelay = 100;
      redisService.cacheLocation.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, cacheDelay)),
      );

      const startTime = Date.now();
      const result = await service.processLocationUpdate(
        'user-123',
        mockLocationDto,
      );
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(endTime - startTime).toBeGreaterThanOrEqual(cacheDelay);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(redisService.cacheLocation).toHaveBeenCalledWith(
        'journey-123',
        'participant-789',
        expect.objectContaining({
          journeyId: 'journey-123',
          participantId: 'participant-789',
          location: expect.objectContaining({
            latitude: 40.7128,
            longitude: -74.006,
          }),
          accuracy: 10,
          heading: 180,
          speed: 25,
          altitude: 100,
          sequenceNumber: 42,
          priority: 'MEDIUM',
        }),
      );
    });

    it('should not throw when location persistence fails', async () => {
      // Mock the repository append to reject
      locationRepository.append.mockRejectedValueOnce(
        new Error('Postgres connection failed'),
      );

      // Mock console.error to verify logging
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const result = await service.processLocationUpdate(
        'user-123',
        mockLocationDto,
      );

      expect(result.success).toBe(true);
      expect(result.sequenceNumber).toBe(42);

      // Flush the microtask queue so the rejected persist promise's .catch runs
      // (deterministic — no arbitrary timer that can flake on slow CI).
      await new Promise((resolve) => setImmediate(resolve));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Location persist failed for user user-123'),
        expect.anything(),
      );

      consoleSpy.mockRestore();
    });

    it('should log location persist failures with userId', async () => {
      locationRepository.append.mockRejectedValueOnce(
        new Error('Database timeout'),
      );

      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await service.processLocationUpdate('user-456', mockLocationDto);

      // Flush the microtask queue so the rejected persist promise's .catch runs.
      await new Promise((resolve) => setImmediate(resolve));

      expect(consoleSpy).toHaveBeenCalledWith(
        'Location persist failed for user user-456: Database timeout',
        expect.anything(),
      );

      consoleSpy.mockRestore();
    });

    it('should cache the LocationUpdate with nested location for snapshots', async () => {
      await service.processLocationUpdate('user-123', mockLocationDto);

      const cacheCall = (redisService.cacheLocation as jest.Mock).mock.calls[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const cached = cacheCall?.[2];
      expect(cached).toHaveProperty(
        'location.latitude',
        mockLocationDto.location.latitude,
      );
      expect(cached).toHaveProperty(
        'location.longitude',
        mockLocationDto.location.longitude,
      );
      expect(cached).toHaveProperty('participantId', 'participant-789');
    });

    it('should preserve sub-service call order before cache write', async () => {
      const callOrder: string[] = [];

      sequenceService.getNextSequence.mockImplementation(() => {
        callOrder.push('sequence');
        return Promise.resolve(42);
      });

      priorityService.calculatePriority.mockImplementation(() => {
        callOrder.push('priority');
        return 'HIGH';
      });

      lagDetectionService.detectLag.mockImplementation(() => {
        callOrder.push('lag');
        return Promise.resolve(null);
      });

      arrivalDetectionService.detectArrival.mockImplementation(() => {
        callOrder.push('arrival');
        return Promise.resolve({
          arrived: false,
          alreadyArrived: false,
          arrivedCount: 0,
          totalCount: 1,
          allArrived: false,
        });
      });

      redisService.cacheLocation.mockImplementation(() => {
        callOrder.push('cache');
        return Promise.resolve();
      });

      await service.processLocationUpdate('user-123', mockLocationDto);

      expect(callOrder).toEqual([
        'priority',
        'sequence',
        'cache',
        'lag',
        'arrival',
      ]);
    });
  });
});
