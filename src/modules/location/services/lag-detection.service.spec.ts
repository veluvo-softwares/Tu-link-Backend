import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LagDetectionService } from './lag-detection.service';
import {
  LagAlertRepository,
  LagAlertRecord,
} from '../../../database/repositories/lag-alert.repository';
import { RedisService } from '../../../shared/redis/redis.service';
import { MapsService } from '../../maps/services/maps.service';
import {
  ParticipantRepository,
  ParticipantRecord,
} from '../../../database/repositories/participant.repository';
import { NotificationService } from '../../notification/notification.service';
import { Journey } from '../../../shared/interfaces/journey.interface';
import { LocationUpdate } from '../../../shared/interfaces/location.interface';

/**
 * NOTIF-16 (+ NOTIF-10/NOTIF-11 regression guard) — LagDetectionService unit
 * tests for the convergence gate added in Plan 06-03.
 *
 * Pure jest unit test: every constructor dependency (Postgres repositories,
 * Redis, Maps, Config, Notification) is mocked. No docker-compose, no real
 * DB/Redis connection.
 */
describe('LagDetectionService — convergence gate (NOTIF-16)', () => {
  let service: LagDetectionService;
  let lagAlertRepository: jest.Mocked<
    Pick<
      LagAlertRepository,
      'upsertActiveForParticipant' | 'resolveActiveForParticipant'
    >
  >;
  let redisService: jest.Mocked<
    Pick<RedisService, 'getJourneyLeader' | 'getCachedLocation'>
  >;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;
  let participantRepository: jest.Mocked<
    Pick<ParticipantRepository, 'findOne' | 'setConvergedIfNotConverged'>
  >;
  let notificationService: jest.Mocked<
    Pick<NotificationService, 'sendConvoyJoined'>
  >;

  const JOURNEY_ID = 'journey-1';
  const FOLLOWER_ID = 'follower-1';
  const LEADER_ID = 'leader-1';

  const journey: Journey = {
    id: JOURNEY_ID,
    name: 'Test Journey',
    leaderId: LEADER_ID,
    status: 'ACTIVE',
    lagThresholdMeters: 500,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
  };

  // ~2.2km from (0,0) — comfortably beyond a 300m rendezvous radius and a
  // 500m lag threshold.
  const farFollowerUpdate: LocationUpdate = {
    journeyId: JOURNEY_ID,
    participantId: FOLLOWER_ID,
    location: { latitude: 0.02, longitude: 0 },
    accuracy: 10,
    timestamp: Date.now(),
  };

  // ~33m from (0,0) — within both the rendezvous radius and the lag threshold.
  const nearFollowerUpdate: LocationUpdate = {
    journeyId: JOURNEY_ID,
    participantId: FOLLOWER_ID,
    location: { latitude: 0.0003, longitude: 0 },
    accuracy: 10,
    timestamp: Date.now(),
  };

  const mockParticipantRecord = (
    overrides: Partial<ParticipantRecord>,
  ): ParticipantRecord => ({
    id: FOLLOWER_ID,
    userId: FOLLOWER_ID,
    journeyId: JOURNEY_ID,
    role: 'FOLLOWER',
    status: 'ACTIVE',
    invitedBy: null,
    connectionStatus: 'CONNECTED',
    joinedAt: null,
    leftAt: null,
    lastSeenAt: null,
    arrivedAt: null,
    convergedAt: null,
    deviceInfo: null,
    ...overrides,
  });

  const mockLagAlertRecord = (
    overrides: Partial<LagAlertRecord>,
  ): LagAlertRecord => ({
    id: 'alert-1',
    journeyId: JOURNEY_ID,
    participantId: FOLLOWER_ID,
    distanceFromLeader: 2200,
    leaderLocation: { latitude: 0, longitude: 0 },
    followerLocation: { latitude: 0.02, longitude: 0 },
    severity: 'CRITICAL',
    isActive: true,
    createdAt: new Date(),
    resolvedAt: null,
    acknowledgedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LagDetectionService,
        {
          provide: LagAlertRepository,
          useValue: {
            upsertActiveForParticipant: jest.fn(),
            resolveActiveForParticipant: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getJourneyLeader: jest.fn(),
            getCachedLocation: jest.fn(),
          },
        },
        { provide: MapsService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: ParticipantRepository,
          useValue: {
            findOne: jest.fn(),
            setConvergedIfNotConverged: jest.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            sendConvoyJoined: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<LagDetectionService>(LagDetectionService);
    lagAlertRepository = module.get(LagAlertRepository);
    redisService = module.get(RedisService);
    configService = module.get(ConfigService);
    participantRepository = module.get(ParticipantRepository);
    notificationService = module.get(NotificationService);

    redisService.getJourneyLeader.mockResolvedValue(LEADER_ID);
    redisService.getCachedLocation.mockResolvedValue({
      journeyId: JOURNEY_ID,
      participantId: LEADER_ID,
      location: { latitude: 0, longitude: 0 },
      accuracy: 10,
      timestamp: Date.now(),
    });
    configService.get.mockImplementation((key: string) => {
      if (key === 'app.rendezvousRadiusMeters') return 300;
      if (key === 'app.criticalLagMeters') return 1000;
      return undefined;
    });
  });

  it('not-yet-converged, beyond rendezvous radius: no lag alert, no notification', async () => {
    participantRepository.findOne.mockResolvedValue(
      mockParticipantRecord({ convergedAt: null }),
    );

    const result = await service.detectLag(farFollowerUpdate, journey);

    expect(result).toBeNull();
    expect(
      participantRepository.setConvergedIfNotConverged,
    ).not.toHaveBeenCalled();
    expect(notificationService.sendConvoyJoined).not.toHaveBeenCalled();
    expect(
      lagAlertRepository.upsertActiveForParticipant,
    ).not.toHaveBeenCalled();
  });

  it('not-yet-converged, crosses rendezvous radius: converges and notifies exactly once', async () => {
    participantRepository.findOne.mockResolvedValue(
      mockParticipantRecord({ convergedAt: null }),
    );
    participantRepository.setConvergedIfNotConverged.mockResolvedValue(
      mockParticipantRecord({ convergedAt: new Date() }),
    );

    const result = await service.detectLag(nearFollowerUpdate, journey);

    expect(result).toBeNull();
    expect(
      participantRepository.setConvergedIfNotConverged,
    ).toHaveBeenCalledTimes(1);
    expect(
      participantRepository.setConvergedIfNotConverged,
    ).toHaveBeenCalledWith(JOURNEY_ID, FOLLOWER_ID);
    expect(notificationService.sendConvoyJoined).toHaveBeenCalledTimes(1);
    expect(notificationService.sendConvoyJoined).toHaveBeenCalledWith(
      JOURNEY_ID,
      FOLLOWER_ID,
      500,
    );
  });

  it('already converged, beyond threshold: creates a lag alert (regression guard)', async () => {
    participantRepository.findOne.mockResolvedValue(
      mockParticipantRecord({ convergedAt: new Date('2024-01-01') }),
    );
    lagAlertRepository.upsertActiveForParticipant.mockResolvedValue(
      mockLagAlertRecord({}),
    );

    const result = await service.detectLag(farFollowerUpdate, journey);

    expect(result).not.toBeNull();
    expect(lagAlertRepository.upsertActiveForParticipant).toHaveBeenCalledTimes(
      1,
    );
    expect(notificationService.sendConvoyJoined).not.toHaveBeenCalled();
  });

  it('already converged, within threshold: resolves active alerts, no new alert (regression guard)', async () => {
    participantRepository.findOne.mockResolvedValue(
      mockParticipantRecord({ convergedAt: new Date('2024-01-01') }),
    );

    const result = await service.detectLag(nearFollowerUpdate, journey);

    expect(result).toBeNull();
    expect(
      lagAlertRepository.resolveActiveForParticipant,
    ).toHaveBeenCalledTimes(1);
    expect(
      lagAlertRepository.upsertActiveForParticipant,
    ).not.toHaveBeenCalled();
  });
});
