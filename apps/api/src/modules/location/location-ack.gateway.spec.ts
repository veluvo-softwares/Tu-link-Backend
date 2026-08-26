import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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

/**
 * `location-update` acknowledgement contract.
 *
 * The Flutter client awaits a `location-update-ack` per `clientPointId` and
 * only falls back to REST when it times out after 10s. The gateway used to
 * return early whenever `result.success` was false — which is the normal
 * outcome for a throttled or de-duplicated update — without emitting any ack at
 * all. A stationary device sends identical coordinates, hits the 2s dedup
 * window, and therefore paid a full 10s stall plus a needless REST retry for
 * every single update.
 *
 * Every path that consumes an update must answer it.
 */
describe('LocationGateway — location-update acknowledgement', () => {
  const JOURNEY_ID = 'journey-ack-test';
  const USER_ID = 'user-ack-test';

  let gateway: LocationGateway;
  let locationService: { processLocationUpdate: jest.Mock };

  const payload = {
    journeyId: JOURNEY_ID,
    clientPointId: 'point-42',
    location: { latitude: -1.2921, longitude: 36.8219 },
    timestamp: Date.now(),
  } as unknown as LocationUpdateDto;

  const makeClient = (): Socket =>
    ({ data: { userId: USER_ID }, emit: jest.fn() }) as unknown as Socket;

  /// Typed so assertions on the payload are not `any` member access.
  const acksFrom = (client: Socket): Array<Record<string, unknown>> =>
    (client.emit as unknown as jest.Mock).mock.calls
      .filter(([event]) => event === 'location-update-ack')
      .map(([, payload]) => payload as Record<string, unknown>);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationGateway,
        {
          provide: ParticipantService,
          useValue: { getJourneyParticipants: jest.fn().mockResolvedValue([]) },
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
            resolveParticipantRecipients: jest.fn().mockReturnValue([]),
            sendArrivalDetected: jest.fn().mockResolvedValue(undefined),
            sendLagAlert: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: FirebaseService, useValue: {} },
        {
          provide: RedisService,
          useValue: { claimLagAlertCooldown: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
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
    locationService = module.get(LocationService);

    // The gateway broadcasts through `server`; stub it so REALTIME succeeds.
    (gateway as unknown as { server: unknown }).server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      in: jest
        .fn()
        .mockReturnValue({ fetchSockets: jest.fn(), emit: jest.fn() }),
    };
  });

  it('acknowledges a throttled or de-duplicated update', async () => {
    // This is the exact shape LocationService returns from its dedup branch.
    locationService.processLocationUpdate.mockResolvedValue({
      success: false,
      sequenceNumber: 0,
      priority: 'LOW',
      shouldBroadcast: false,
    });
    const client = makeClient();

    await gateway.handleLocationUpdate(client, payload);

    const acks = acksFrom(client);
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({
      clientPointId: 'point-42',
      accepted: false,
      reason: 'THROTTLED_OR_DUPLICATE',
    });
  });

  it('echoes the clientPointId so the right publish completes', async () => {
    // Without the echo the client cannot tell which in-flight publish was
    // answered and has to guess.
    locationService.processLocationUpdate.mockResolvedValue({
      success: false,
      sequenceNumber: 0,
      priority: 'LOW',
      shouldBroadcast: false,
    });
    const client = makeClient();

    await gateway.handleLocationUpdate(client, payload);

    expect(acksFrom(client)[0].clientPointId).toBe('point-42');
  });

  it('acknowledges an accepted update', async () => {
    locationService.processLocationUpdate.mockResolvedValue({
      success: true,
      sequenceNumber: 7,
      priority: 'HIGH',
      shouldBroadcast: true,
    });
    const client = makeClient();

    await gateway.handleLocationUpdate(client, payload);

    const acks = acksFrom(client);
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ sequenceNumber: 7 });
  });

  it('acknowledges even when processing throws', async () => {
    // A server error is still an answer. With no ack the client waited the
    // full timeout before falling back.
    locationService.processLocationUpdate.mockRejectedValue(
      new Error('redis unavailable'),
    );
    const client = makeClient();

    await gateway.handleLocationUpdate(client, payload);

    const acks = acksFrom(client);
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({
      accepted: false,
      reason: 'SERVER_ERROR',
    });
  });

  describe('rejection reasons are typed, so the client knows what to do', () => {
    // The client acts on `reason`: a retryable rejection keeps the point in
    // its offline outbox and falls back to REST, a terminal one surfaces a
    // typed failure and stops. Answering everything with SERVER_ERROR made a
    // permanently-rejected payload retry forever.
    const cases: Array<[Error, string]> = [
      [
        new ForbiddenException('Not a participant of this journey'),
        'NOT_PARTICIPANT',
      ],
      [new NotFoundException('Journey not found'), 'NOT_PARTICIPANT'],
      [new UnauthorizedException('Token revoked'), 'UNAUTHORIZED'],
      [
        new BadRequestException('latitude must be a number'),
        'VALIDATION_ERROR',
      ],
      [new BadRequestException('Rate limit exceeded'), 'SERVER_ERROR'],
      [new Error('Journey is not active'), 'JOURNEY_NOT_ACTIVE'],
      [new Error('redis unavailable'), 'SERVER_ERROR'],
    ];

    it.each(cases)('%s → %s', async (error, expected) => {
      locationService.processLocationUpdate.mockRejectedValue(error);
      const client = makeClient();

      await gateway.handleLocationUpdate(client, payload);

      const acks = acksFrom(client);
      expect(acks).toHaveLength(1);
      expect(acks[0]).toMatchObject({
        clientPointId: 'point-42',
        accepted: false,
        reason: expected,
      });
    });

    it('a rate limit stays retryable so the point is not dropped', async () => {
      locationService.processLocationUpdate.mockRejectedValue(
        new BadRequestException('Rate limit exceeded'),
      );
      const client = makeClient();

      await gateway.handleLocationUpdate(client, payload);

      expect(acksFrom(client)[0].reason).toBe('SERVER_ERROR');
    });
  });

  it('never leaves an update unanswered on any outcome', async () => {
    // Guards future branches: whatever the result, exactly one ack goes back.
    for (const result of [
      { success: false, sequenceNumber: 0, priority: 'LOW' },
      { success: true, sequenceNumber: 1, priority: 'HIGH' },
    ]) {
      locationService.processLocationUpdate.mockResolvedValue(result);
      const client = makeClient();

      await gateway.handleLocationUpdate(client, payload);

      expect(acksFrom(client)).toHaveLength(1);
    }
  });
});
