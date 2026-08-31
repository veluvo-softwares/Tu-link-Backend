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

describe('LocationGateway — resumable join handshake', () => {
  let gateway: LocationGateway;
  let locationService: {
    handleResyncRequest: jest.Mock;
    getLatestLocations: jest.Mock;
  };
  let client: Socket;
  let emit: jest.Mock;

  beforeEach(async () => {
    locationService = {
      handleResyncRequest: jest.fn(),
      getLatestLocations: jest.fn().mockResolvedValue({ locations: [] }),
    };
    emit = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationGateway,
        { provide: FirebaseService, useValue: {} },
        {
          provide: RedisService,
          useValue: {
            addSocketToRoom: jest.fn(),
            addJourneyParticipant: jest.fn(),
            setConnectionStatus: jest.fn(),
          },
        },
        {
          provide: ParticipantService,
          useValue: {
            isParticipant: jest.fn().mockResolvedValue(true),
            updateConnectionStatus: jest.fn(),
          },
        },
        { provide: JourneyService, useValue: {} },
        { provide: JourneyMetricsService, useValue: {} },
        { provide: LocationService, useValue: locationService },
        { provide: LocationBatchingService, useValue: {} },
        { provide: WebSocketMetricsService, useValue: {} },
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
        { provide: NotificationService, useValue: {} },
      ],
    }).compile();

    gateway = module.get(LocationGateway);
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit }),
    } as unknown as typeof gateway.server;
    client = {
      id: 'socket-1',
      data: { userId: 'user-1' },
      join: jest.fn().mockResolvedValue(undefined),
      emit,
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    } as unknown as Socket;
  });

  it('returns a bounded missed-update delta when the cursor is current', async () => {
    locationService.handleResyncRequest.mockResolvedValue({
      updates: [{ sequenceNumber: 42 }],
      nextSequence: 42,
      hasMore: false,
    });

    await gateway.handleJoinJourney(client, {
      journeyId: 'journey-1',
      lastLocationSequence: 41,
    });

    expect(locationService.handleResyncRequest).toHaveBeenCalledWith(
      'user-1',
      'journey-1',
      41,
      500,
    );
    expect(emit).toHaveBeenCalledWith(
      'joined-journey',
      expect.objectContaining({
        journeyId: 'journey-1',
        recovery: {
          mode: 'DELTA',
          updates: [{ sequenceNumber: 42 }],
          nextSequence: 42,
          hasMore: false,
        },
      }),
    );
  });

  it('requests a canonical snapshot when the delta exceeds the join limit', async () => {
    locationService.handleResyncRequest.mockResolvedValue({
      updates: [],
      nextSequence: 541,
      hasMore: true,
    });

    await gateway.handleJoinJourney(client, {
      journeyId: 'journey-1',
      lastLocationSequence: 40,
    });

    expect(emit).toHaveBeenCalledWith(
      'joined-journey',
      expect.objectContaining({
        recovery: {
          mode: 'SNAPSHOT_REQUIRED',
          reason: 'CURSOR_TOO_OLD',
        },
      }),
    );
  });

  it('requests a snapshot without querying history when no cursor exists', async () => {
    await gateway.handleJoinJourney(client, { journeyId: 'journey-1' });

    expect(locationService.handleResyncRequest).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'joined-journey',
      expect.objectContaining({
        recovery: { mode: 'SNAPSHOT_REQUIRED', reason: 'NO_CURSOR' },
      }),
    );
  });
});
