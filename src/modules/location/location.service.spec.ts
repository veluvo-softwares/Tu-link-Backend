/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LocationService } from './location.service';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { RedisService } from '../../shared/redis/redis.service';
import { JourneyService } from '../journey/journey.service';
import { ParticipantService } from '../journey/services/participant.service';
import { AcknowledgmentService } from './services/acknowledgment.service';
import { PriorityService } from './services/priority.service';
import { SequenceService } from './services/sequence.service';
import { LagDetectionService } from './services/lag-detection.service';
import { ArrivalDetectionService } from './services/arrival-detection.service';
import { LocationUpdateDto } from './dto/location-update.dto';

describe('LocationService - Hybrid RTDB/Firestore', () => {
  let service: LocationService;
  let firebaseService: jest.Mocked<FirebaseService>;
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
    const mockFirebaseService = {
      setMemberPosition: jest.fn().mockResolvedValue(undefined),
      removeMemberPosition: jest.fn().mockResolvedValue(undefined),
      clearJourneyPositions: jest.fn().mockResolvedValue(undefined),
      firestore: {
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            collection: jest.fn(() => ({
              doc: jest.fn(() => ({
                set: jest.fn().mockResolvedValue(undefined),
              })),
              where: jest.fn(() => ({
                orderBy: jest.fn(() => ({
                  limit: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({
                      empty: true,
                      docs: [],
                    }),
                  })),
                })),
              })),
            })),
          })),
        })),
      },
    };

    const mockRedisService = {
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
          provide: FirebaseService,
          useValue: mockFirebaseService,
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
            shouldThrottleForBattery: jest.fn().mockReturnValue(false),
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
    firebaseService = module.get(FirebaseService);
    priorityService = module.get(PriorityService);
    sequenceService = module.get(SequenceService);
    lagDetectionService = module.get(LagDetectionService);
    arrivalDetectionService = module.get(ArrivalDetectionService);
  });

  describe('processLocationUpdate - Hybrid Behavior', () => {
    it('should await RTDB write before method returns', async () => {
      const rtdbDelay = 100;
      firebaseService.setMemberPosition.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, rtdbDelay)),
      );

      const startTime = Date.now();
      const result = await service.processLocationUpdate(
        'user-123',
        mockLocationDto,
      );
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(endTime - startTime).toBeGreaterThanOrEqual(rtdbDelay);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(firebaseService.setMemberPosition).toHaveBeenCalledWith(
        'journey-123',
        'user-123',
        expect.objectContaining({
          lat: 40.7128,
          lng: -74.006,
          accuracy: 10,
          heading: 180,
          speed: 25,
          altitude: 100,
          timestamp: 1640995200000,
          userId: 'user-123',
          sequenceNumber: 42,
          priority: 'MEDIUM',
          metadata: expect.objectContaining({
            batteryLevel: 80,
            isMoving: true,
          }),
        }),
      );
    });

    it('should not throw when Firestore persistence fails', async () => {
      // Mock Firestore to reject
      const firestoreError = new Error('Firestore connection failed');
      const mockSet = jest.fn().mockRejectedValue(firestoreError);

      const mockFirestore = {
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            collection: jest.fn(() => ({
              doc: jest.fn(() => ({
                set: mockSet,
              })),
              where: jest.fn(() => ({
                orderBy: jest.fn(() => ({
                  limit: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({
                      empty: true,
                      docs: [],
                    }),
                  })),
                })),
              })),
            })),
          })),
        })),
      };

      firebaseService.firestore = mockFirestore as any;

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

      // Give async Firestore operation time to fail and be caught
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Firestore persist failed for user user-123'),
        expect.anything(),
      );

      consoleSpy.mockRestore();
    });

    it('should log Firestore failures with userId', async () => {
      const firestoreError = new Error('Database timeout');
      const mockSet = jest.fn().mockRejectedValue(firestoreError);

      const mockFirestore = {
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            collection: jest.fn(() => ({
              doc: jest.fn(() => ({
                set: mockSet,
              })),
              where: jest.fn(() => ({
                orderBy: jest.fn(() => ({
                  limit: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({
                      empty: true,
                      docs: [],
                    }),
                  })),
                })),
              })),
            })),
          })),
        })),
      };

      firebaseService.firestore = mockFirestore as any;

      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await service.processLocationUpdate('user-456', mockLocationDto);

      // Wait for async operation
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalledWith(
        'Firestore persist failed for user user-456: Database timeout',
        expect.anything(),
      );

      consoleSpy.mockRestore();
    });

    it('should flatten DTO location structure correctly in RTDB payload', async () => {
      await service.processLocationUpdate('user-123', mockLocationDto);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(firebaseService.setMemberPosition).toHaveBeenCalledWith(
        'journey-123',
        'user-123',
        expect.objectContaining({
          lat: mockLocationDto.location.latitude,
          lng: mockLocationDto.location.longitude,
        }),
      );

      // Verify nested location object is NOT passed to RTDB
      const rtdbCall = (firebaseService.setMemberPosition as jest.Mock).mock
        .calls[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const payload = rtdbCall?.[2];
      expect(payload).not.toHaveProperty('location');
      expect(payload).not.toHaveProperty('location.latitude');
    });

    it('should preserve sub-service call order before RTDB write', async () => {
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
        return Promise.resolve(false);
      });

      firebaseService.setMemberPosition.mockImplementation(() => {
        callOrder.push('rtdb');
        return Promise.resolve();
      });

      await service.processLocationUpdate('user-123', mockLocationDto);

      expect(callOrder).toEqual([
        'priority',
        'sequence',
        'rtdb',
        'lag',
        'arrival',
      ]);
    });
  });
});
