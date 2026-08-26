import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
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

/**
 * `participant-accepted` must carry its own journey identity.
 *
 * The event is room-scoped on the wire, but a client can be handing rooms over
 * when it arrives, so it cannot safely infer identity from whichever room it
 * currently believes it is in. The Flutter client used to do exactly that, and
 * a late acceptance for journey A refreshed journey B's roster.
 *
 * The stamp is additive: `journeyId` sits alongside the existing
 * userId/displayName/status keys, so older clients are unaffected.
 */
describe('LocationGateway — participant-accepted identity', () => {
  let gateway: LocationGateway;
  let emit: jest.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationGateway,
        { provide: ParticipantService, useValue: {} },
        { provide: JourneyService, useValue: {} },
        { provide: JourneyMetricsService, useValue: {} },
        { provide: LocationService, useValue: {} },
        { provide: LocationBatchingService, useValue: {} },
        { provide: WebSocketMetricsService, useValue: {} },
        { provide: NotificationService, useValue: {} },
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
    emit = jest.fn();
    (gateway as unknown as { server: unknown }).server = {
      to: jest.fn().mockReturnValue({ emit }),
      in: jest
        .fn()
        .mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) }),
    };
  });

  it('stamps the journeyId into the broadcast payload', async () => {
    await gateway.broadcastParticipantAccepted('journey-42', {
      userId: 'user-1',
      displayName: 'Amina',
      status: 'ACCEPTED',
    });

    expect(emit).toHaveBeenCalledWith('participant-accepted', {
      userId: 'user-1',
      displayName: 'Amina',
      status: 'ACCEPTED',
      journeyId: 'journey-42',
    });
  });

  it('keeps every existing key, so old clients are unaffected', async () => {
    await gateway.broadcastParticipantAccepted('journey-42', {
      userId: 'user-1',
      displayName: 'Amina',
      status: 'ACTIVE',
    });

    const payload = (emit.mock.calls[0] as unknown[])[1] as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual(
      ['displayName', 'journeyId', 'status', 'userId'].sort(),
    );
  });

  it('emits to the journey room it stamped', async () => {
    const server = (gateway as unknown as { server: { to: jest.Mock } }).server;

    await gateway.broadcastParticipantAccepted('journey-42', { userId: 'u' });

    expect(server.to).toHaveBeenCalledWith('journey:journey-42');
  });
});
