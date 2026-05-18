/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { UseFilters, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { RedisService } from '../../shared/redis/redis.service';
import { LoggerService } from '../../shared/logger/logger.service';
import { ParticipantService } from '../journey/services/participant.service';
import { JourneyService } from '../journey/journey.service';
import { JourneyMetricsService } from '../journey/services/journey-metrics.service';
import { LocationService } from './location.service';
import { LocationBatchingService } from './services/location-batching.service';
import { WebSocketMetricsService } from './services/websocket-metrics.service';
import { LocationUpdateDto } from './dto/location-update.dto';
import { AcknowledgeDto } from './dto/acknowledge.dto';
import { ResyncDto } from './dto/resync.dto';
import { WsExceptionFilter } from '../../common/filters/ws-exception.filter';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/location',
  transports: ['websocket'],
})
@UseFilters(new WsExceptionFilter())
export class LocationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private firebaseService: FirebaseService,
    private redisService: RedisService,
    @Inject(forwardRef(() => ParticipantService))
    private participantService: ParticipantService,
    @Inject(forwardRef(() => JourneyService))
    private journeyService: JourneyService,
    @Inject(forwardRef(() => JourneyMetricsService))
    private journeyMetricsService: JourneyMetricsService,
    private locationService: LocationService,
    private locationBatchingService: LocationBatchingService,
    private webSocketMetricsService: WebSocketMetricsService,
    private configService: ConfigService,
    private logger: LoggerService,
  ) {}

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake
      const token =
        client.handshake.auth.token ||
        client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        client.emit('error', { message: 'No authentication token provided' });
        client.disconnect();
        return;
      }

      // Verify Firebase token
      const decodedToken = await this.firebaseService.auth.verifyIdToken(token);
      const userId = decodedToken.uid;

      // Store user info in socket data
      client.data.userId = userId;
      client.data.email = decodedToken.email;

      // Map socket to user in Redis
      await this.redisService.setSocketUser(client.id, userId);

      console.log(`Client connected: ${client.id} (User: ${userId})`);

      // Send connection success
      client.emit('connection-status', {
        status: 'CONNECTED',
        message: 'Successfully connected to location service',
      });

      // Start heartbeat monitoring
      this.startHeartbeatMonitoring(client);
    } catch (error) {
      console.error('Connection authentication failed:', error);
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  async handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    const journeyId = client.data.journeyId;

    console.log(`Client disconnected: ${client.id} (User: ${userId})`);

    // Clear heartbeat timers
    this.stopHeartbeatMonitoring(client.id);

    // Update connection status in Redis
    if (userId) {
      await this.redisService.setConnectionStatus(userId, false);
    }

    // Remove from journey room
    if (journeyId) {
      await this.redisService.removeSocketFromRoom(journeyId, client.id);
      void client.leave(`journey:${journeyId}`);

      // Update participant connection status
      if (userId) {
        await this.participantService.updateConnectionStatus(
          journeyId,
          userId,
          'DISCONNECTED',
        );

        // Remove member position from RTDB
        await this.firebaseService.removeMemberPosition(journeyId, userId);

        // Notify other participants
        this.server
          .to(`journey:${journeyId}`)
          .emit('participant-disconnected', {
            userId,
            timestamp: Date.now(),
          });
      }
    }

    // Clean up Redis mapping
    await this.redisService.deleteSocketUser(client.id);
  }

  /**
   * Join a journey room
   */
  @SubscribeMessage('join-journey')
  async handleJoinJourney(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { journeyId: string },
  ) {
    const userId = client.data.userId;
    const { journeyId } = payload;

    try {
      // Verify participant membership
      const isParticipant = await this.participantService.isParticipant(
        journeyId,
        userId,
      );
      if (!isParticipant) {
        throw new WsException('Not a participant of this journey');
      }

      // Join Socket.io room
      await client.join(`journey:${journeyId}`);

      // Store journey in client data
      client.data.journeyId = journeyId;

      // Add to Redis room mapping
      await this.redisService.addSocketToRoom(journeyId, client.id);

      // Update participant connection status
      await this.participantService.updateConnectionStatus(
        journeyId,
        userId,
        'CONNECTED',
      );
      await this.redisService.setConnectionStatus(userId, true);

      console.log(`User ${userId} joined journey ${journeyId}`);

      // Send success response
      client.emit('joined-journey', {
        journeyId,
        message: 'Successfully joined journey',
        timestamp: Date.now(),
      });

      // Notify other participants
      client.to(`journey:${journeyId}`).emit('participant-joined', {
        userId,
        timestamp: Date.now(),
      });

      // Send latest locations to the newly joined participant
      const latestLocations = await this.locationService.getLatestLocations(
        journeyId,
        userId,
      );
      client.emit('latest-locations', latestLocations);
    } catch (error) {
      client.emit('error', {
        message: error.message || 'Failed to join journey',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Leave a journey room
   */
  @SubscribeMessage('leave-journey')
  async handleLeaveJourney(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { journeyId: string },
  ) {
    const userId = client.data.userId;
    const { journeyId } = payload;

    try {
      // Leave Socket.io room
      await client.leave(`journey:${journeyId}`);

      // Remove from Redis room mapping
      await this.redisService.removeSocketFromRoom(journeyId, client.id);

      // Update participant connection status
      await this.participantService.updateConnectionStatus(
        journeyId,
        userId,
        'DISCONNECTED',
      );

      // Remove member position from RTDB
      await this.firebaseService.removeMemberPosition(journeyId, userId);

      // Clear from client data
      client.data.journeyId = null;

      console.log(`User ${userId} left journey ${journeyId}`);

      // Send confirmation
      client.emit('left-journey', {
        journeyId,
        message: 'Successfully left journey',
        timestamp: Date.now(),
      });

      // Notify other participants
      client.to(`journey:${journeyId}`).emit('participant-left', {
        userId,
        timestamp: Date.now(),
      });
    } catch (error) {
      client.emit('error', {
        message: error.message || 'Failed to leave journey',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle location update from client with adaptive strategy
   */
  @SubscribeMessage('location-update')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: LocationUpdateDto,
  ) {
    const userId = client.data.userId;
    const startTime = Date.now();

    try {
      // Process the location update
      const result = await this.locationService.processLocationUpdate(
        userId,
        payload,
      );

      if (!result.success) {
        // Throttled - don't broadcast
        this.logger.info(
          `Location update received — userId resolved as: ${userId}`,
          'LocationGateway',
        );
        this.logger.info(
          `Location update received — result: ${JSON.stringify(result)}`,
          'LocationGateway',
        );
        return;
      }

      // Get optimal strategy for this journey
      const strategy = await this.journeyMetricsService.getJourneyStrategy(
        payload.journeyId,
      );

      // Route to appropriate handler based on strategy
      switch (strategy) {
        case 'REALTIME':
          this.handleRealTimeUpdate(client, payload, result);
          break;
        case 'BATCHED':
          await this.handleBatchedUpdate(client, payload, result);
          break;
        case 'POLLING':
          await this.handlePollingUpdate(client, payload, result);
          break;
        default:
          // Fallback to real-time
          this.handleRealTimeUpdate(client, payload, result);
      }

      // Update performance metrics
      const latency = Date.now() - startTime;
      await this.journeyMetricsService.updateStrategyMetrics(
        payload.journeyId,
        strategy,
        latency,
      );

      // Track metrics in WebSocket metrics service
      await this.webSocketMetricsService.trackBroadcastMetrics(
        payload.journeyId,
        strategy,
        latency,
        false, // No error if we reach this point
      );

      // Send lag alert if detected
      if (result.lagAlert) {
        this.server.to(`journey:${payload.journeyId}`).emit('lag-alert', {
          participantId: result.lagAlert.participantId,
          userId: result.lagAlert.userId,
          distanceFromLeader: result.lagAlert.distanceFromLeader,
          severity: result.lagAlert.severity,
          timestamp: Date.now(),
        });
      }

      // Handle arrival events
      if (result.arrival?.arrived) {
        const { arrivedCount, totalCount, allArrived } = result.arrival;

        // Notify all journey members of this participant's arrival with progress
        this.server
          .to(`journey:${payload.journeyId}`)
          .emit('participant-arrived', {
            userId,
            arrivedCount,
            totalCount,
            allArrived,
            timestamp: Date.now(),
          });

        // Auto-complete the journey when everyone has arrived
        if (allArrived) {
          try {
            const journey = await this.journeyService.autoCompleteJourney(
              payload.journeyId,
            );
            await this.broadcastJourneyEnded(payload.journeyId, journey);
          } catch (endError) {
            this.logger.error(
              `Auto-complete failed for journey ${payload.journeyId}: ${endError.message}`,
              'LocationGateway',
            );
          }
        }
      }
    } catch (error) {
      const latency = Date.now() - startTime;

      this.logger.error(
        `Failed to process location update for journey ${payload.journeyId}: ${error.message}`,
        'LocationGateway',
      );

      // Track error metrics
      try {
        const strategy = await this.journeyMetricsService.getJourneyStrategy(
          payload.journeyId,
        );
        await this.webSocketMetricsService.trackBroadcastMetrics(
          payload.journeyId,
          strategy,
          latency,
          true, // This is an error
        );
      } catch (metricsError) {
        // Don't fail the main operation if metrics tracking fails
        this.logger.error(
          `Failed to track error metrics: ${metricsError.message}`,
        );
      }

      client.emit('error', {
        message: error.message || 'Failed to process location update',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle real-time location update (immediate broadcast)
   */
  private handleRealTimeUpdate(
    client: Socket,
    payload: LocationUpdateDto,
    result: any,
  ): void {
    const userId = client.data.userId;

    // Send immediate acknowledgment to sender
    client.emit('location-update-ack', {
      sequenceNumber: result.sequenceNumber,
      priority: result.priority,
      timestamp: Date.now(),
      strategy: 'REALTIME',
    });

    // Immediate broadcast to all participants
    if (result.shouldBroadcast) {
      this.server.to(`journey:${payload.journeyId}`).emit('location-update', {
        userId,
        participantId: client.data.userId,
        location: payload.location,
        accuracy: payload.accuracy,
        heading: payload.heading,
        speed: payload.speed,
        altitude: payload.altitude,
        timestamp: result.sequenceNumber,
        sequenceNumber: result.sequenceNumber,
        priority: result.priority,
        metadata: payload.metadata,
      });
    }

    this.logger.debug(
      `Real-time update processed for journey ${payload.journeyId}`,
      'LocationGateway',
    );
  }

  /**
   * Handle batched location update (add to batch)
   */
  private async handleBatchedUpdate(
    client: Socket,
    payload: LocationUpdateDto,
    result: any,
  ): Promise<void> {
    const userId = client.data.userId;

    // Transform to location update format
    const locationUpdate = {
      journeyId: payload.journeyId,
      participantId: userId,
      location: payload.location,
      accuracy: payload.accuracy,
      heading: payload.heading,
      speed: payload.speed,
      altitude: payload.altitude,
      timestamp: result.sequenceNumber,
      sequenceNumber: result.sequenceNumber,
      priority: result.priority,
      metadata: payload.metadata,
    };

    // Add to batch
    if (result.shouldBroadcast) {
      await this.locationBatchingService.addToBatch(
        payload.journeyId,
        locationUpdate,
      );
    }

    // Get next broadcast time
    const nextBroadcast =
      Date.now() +
      this.locationBatchingService.getTimeUntilNextFlush(payload.journeyId);

    // Send acknowledgment with batch info
    client.emit('location-update-ack', {
      sequenceNumber: result.sequenceNumber,
      priority: result.priority,
      timestamp: Date.now(),
      strategy: 'BATCHED',
      nextBroadcast,
    });

    this.logger.debug(
      `Batched update added for journey ${payload.journeyId}. Next flush in ${this.locationBatchingService.getTimeUntilNextFlush(payload.journeyId)}ms`,
      'LocationGateway',
    );
  }

  /**
   * Handle polling-based update (RTDB only, no WebSocket broadcast)
   */
  private async handlePollingUpdate(
    client: Socket,
    payload: LocationUpdateDto,
    result: any,
  ): Promise<void> {
    const userId = client.data.userId;

    // Write directly to RTDB without WebSocket broadcast
    if (result.shouldBroadcast) {
      const locationUpdate = {
        location: payload.location,
        accuracy: payload.accuracy,
        heading: payload.heading,
        speed: payload.speed,
        altitude: payload.altitude,
        timestamp: result.sequenceNumber,
        sequenceNumber: result.sequenceNumber,
        priority: result.priority,
        metadata: payload.metadata,
      };

      await this.firebaseService.updateMemberPosition(
        payload.journeyId,
        userId,
        locationUpdate,
      );
    }

    // Send acknowledgment with polling instruction
    client.emit('location-update-ack', {
      sequenceNumber: result.sequenceNumber,
      priority: result.priority,
      timestamp: Date.now(),
      strategy: 'POLLING',
      pollEndpoint: `/locations/journeys/${payload.journeyId}/poll`,
      recommendedInterval:
        this.configService.get('app.websocket.pollingIntervalMs') || 5000,
    });

    this.logger.debug(
      `Polling update stored in RTDB for journey ${payload.journeyId}`,
      'LocationGateway',
    );
  }

  /**
   * Handle acknowledgment from client
   */
  @SubscribeMessage('acknowledge')
  async handleAcknowledge(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AcknowledgeDto,
  ) {
    const userId = client.data.userId;
    const journeyId = client.data.journeyId;

    try {
      await this.locationService.handleAcknowledgment(
        userId,
        journeyId,
        payload.sequenceNumber,
      );

      client.emit('acknowledge-received', {
        sequenceNumber: payload.sequenceNumber,
        timestamp: Date.now(),
      });
    } catch (error) {
      client.emit('error', {
        message: error.message || 'Failed to process acknowledgment',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle resync request when client detects gaps
   */
  @SubscribeMessage('request-resync')
  async handleResyncRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ResyncDto,
  ) {
    const userId = client.data.userId;
    const journeyId = client.data.journeyId;

    try {
      const missingUpdates = await this.locationService.handleResyncRequest(
        userId,
        journeyId,
        payload.fromSequence,
      );

      client.emit('resync-data', {
        updates: missingUpdates,
        count: missingUpdates.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      client.emit('error', {
        message: error.message || 'Failed to resync',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle heartbeat from client
   */
  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;

    // Update last heartbeat in Redis
    if (userId) {
      await this.redisService.setLastHeartbeat(userId);
    }

    // Reset timeout
    this.resetHeartbeatTimeout(client);

    // Send heartbeat response
    client.emit('heartbeat-ack', {
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast journey started event
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async broadcastJourneyStarted(journeyId: string, journey: any) {
    this.server.to(`journey:${journeyId}`).emit('journey-started', {
      journey,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast journey ended event
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async broadcastJourneyEnded(journeyId: string, journey: any) {
    this.server.to(`journey:${journeyId}`).emit('journey-ended', {
      journey,
      timestamp: Date.now(),
    });
  }

  /**
   * Start heartbeat monitoring for a client
   */
  private startHeartbeatMonitoring(client: Socket) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const heartbeatInterval = this.configService.get('app.heartbeatIntervalMs');
    const heartbeatTimeout = this.configService.get('app.heartbeatTimeoutMs');

    // Set initial timeout
    const timeout = setTimeout(() => {
      console.log(`Heartbeat timeout for client ${client.id}`);
      client.emit('connection-status', { status: 'TIMEOUT' });
      client.disconnect();
    }, heartbeatTimeout);

    this.heartbeatTimeouts.set(client.id, timeout);
  }

  /**
   * Reset heartbeat timeout
   */
  private resetHeartbeatTimeout(client: Socket) {
    // Clear existing timeout
    const existingTimeout = this.heartbeatTimeouts.get(client.id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const heartbeatTimeout = this.configService.get('app.heartbeatTimeoutMs');
    const timeout = setTimeout(() => {
      console.log(`Heartbeat timeout for client ${client.id}`);
      client.emit('connection-status', { status: 'TIMEOUT' });
      client.disconnect();
    }, heartbeatTimeout);

    this.heartbeatTimeouts.set(client.id, timeout);
  }

  /**
   * Stop heartbeat monitoring for a client
   */
  private stopHeartbeatMonitoring(clientId: string) {
    const interval = this.heartbeatIntervals.get(clientId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(clientId);
    }

    const timeout = this.heartbeatTimeouts.get(clientId);
    if (timeout) {
      clearTimeout(timeout);
      this.heartbeatTimeouts.delete(clientId);
    }
  }
}
