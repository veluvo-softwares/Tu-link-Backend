/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { LocationGateway } from './location.gateway';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { RedisService } from '../../shared/redis/redis.service';
import { LoggerService } from '../../shared/logger/logger.service';
import { ParticipantService } from '../journey/services/participant.service';
import { JourneyService } from '../journey/journey.service';
import { JourneyMetricsService } from '../journey/services/journey-metrics.service';
import { LocationService } from './location.service';
import { LocationBatchingService } from './services/location-batching.service';
import { WebSocketMetricsService } from './services/websocket-metrics.service';
import { NotificationService } from '../notification/notification.service';
import { LocationUpdateDto } from './dto/location-update.dto';
import { Participant } from '../../shared/interfaces/participant.interface';

/**
 * NOTIF-08 — LocationGateway arrival wiring unit test.
 *
 * Verifies that handleLocationUpdate, on a real arrival transition, fires
 * notificationService.sendArrivalDetected with a recipient list that excludes
 * the arriver (D-02), and does NOT fire it on non-arrival updates.
 *
 * Pure jest mocks — no docker / no DB. Every constructor dependency is stubbed.
 */
describe('LocationGateway — arrival notification (NOTIF-08)', () => {
  let gateway: LocationGateway;
  let participantService: jest.Mocked<
    Pick<ParticipantService, 'getJourneyParticipants'>
  >;
  let journeyService: jest.Mocked<Pick<JourneyService, 'findById'>>;
  let locationService: jest.Mocked<
    Pick<LocationService, 'processLocationUpdate'>
  >;
  let notificationService: jest.Mocked<
    Pick<
      NotificationService,
      'resolveParticipantRecipients' | 'sendArrivalDetected'
    >
  >;

  const JOURNEY_ID = 'journey-123';
  const ARRIVER_ID = 'arriver-id';

  const participants: Participant[] = [
    {
      id: 'p-leader',
      userId: 'leader-id',
      journeyId: JOURNEY_ID,
      role: 'LEADER',
      status: 'ACTIVE',
      connectionStatus: 'CONNECTED',
      displayName: 'Leader',
    },
    {
      id: 'p-arriver',
      userId: ARRIVER_ID,
      journeyId: JOURNEY_ID,
      role: 'FOLLOWER',
      status: 'ACTIVE',
      connectionStatus: 'CONNECTED',
      displayName: 'Alice',
    },
    {
      id: 'p-other',
      userId: 'other-id',
      journeyId: JOURNEY_ID,
      role: 'FOLLOWER',
      status: 'ACTIVE',
      connectionStatus: 'CONNECTED',
      displayName: 'Bob',
    },
  ];

  const payload: LocationUpdateDto = {
    journeyId: JOURNEY_ID,
    location: { latitude: 40.7128, longitude: -74.006 },
    accuracy: 10,
    heading: 180,
    speed: 25,
    altitude: 100,
    timestamp: 1640995200000,
    metadata: { batteryLevel: 80, isMoving: true },
  } as LocationUpdateDto;

  const makeClient = (userId: string): Socket =>
    ({
      data: { userId },
      emit: jest.fn(),
    }) as unknown as Socket;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationGateway,
        {
          provide: ParticipantService,
          useValue: { getJourneyParticipants: jest.fn() },
        },
        { provide: JourneyService, useValue: { findById: jest.fn() } },
        {
          provide: JourneyMetricsService,
          useValue: {
            getJourneyStrategy: jest.fn().mockResolvedValue('REALTIME'),
            updateStrategyMetrics: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: LocationService,
          useValue: { processLocationUpdate: jest.fn() },
        },
        {
          provide: LocationBatchingService,
          useValue: { addToBatch: jest.fn(), flushBatch: jest.fn() },
        },
        {
          provide: WebSocketMetricsService,
          useValue: {
            trackBroadcastMetrics: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            resolveParticipantRecipients: jest.fn(),
            sendArrivalDetected: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: FirebaseService, useValue: {} },
        { provide: RedisService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: LoggerService,
          useValue: {
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    gateway = module.get<LocationGateway>(LocationGateway);
    participantService = module.get(ParticipantService);
    journeyService = module.get(JourneyService);
    locationService = module.get(LocationService);
    notificationService = module.get(NotificationService);

    // Mock the socket.io server so broadcast chains do not throw.
    const emit = jest.fn();
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit }),
    } as unknown as typeof gateway.server;
  });

  it('fires sendArrivalDetected for recipients excluding the arriver on a real arrival', async () => {
    locationService.processLocationUpdate.mockResolvedValue({
      success: true,
      shouldBroadcast: false,
      sequenceNumber: 1,
      priority: 'HIGH',
      arrival: {
        arrived: true,
        arrivedCount: 1,
        totalCount: 3,
        allArrived: false,
      },
    } as any);
    participantService.getJourneyParticipants.mockResolvedValue(participants);
    notificationService.resolveParticipantRecipients.mockReturnValue([
      'leader-id',
      'other-id',
    ]);
    journeyService.findById.mockResolvedValue({
      id: JOURNEY_ID,
      name: 'Test Journey',
    } as any);

    await gateway.handleLocationUpdate(makeClient(ARRIVER_ID), payload);

    // Recipient resolution is passed the full participant list + arriver as actor.
    expect(
      notificationService.resolveParticipantRecipients,
    ).toHaveBeenCalledWith(participants, ARRIVER_ID);

    // Notification is sent with the arriver's display name and the actor-excluded list.
    expect(notificationService.sendArrivalDetected).toHaveBeenCalledWith(
      JOURNEY_ID,
      'Test Journey',
      'Alice',
      ['leader-id', 'other-id'],
    );
  });

  it('does NOT fire sendArrivalDetected when the update is not an arrival transition', async () => {
    locationService.processLocationUpdate.mockResolvedValue({
      success: true,
      shouldBroadcast: false,
      sequenceNumber: 2,
      priority: 'LOW',
      arrival: { arrived: false },
    } as any);

    await gateway.handleLocationUpdate(makeClient(ARRIVER_ID), payload);

    expect(notificationService.sendArrivalDetected).not.toHaveBeenCalled();
    expect(
      notificationService.resolveParticipantRecipients,
    ).not.toHaveBeenCalled();
  });
});
