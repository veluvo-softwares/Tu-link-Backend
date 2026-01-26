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
import { UseFilters } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { RedisService } from '../../shared/redis/redis.service';
import { ParticipantService } from '../journey/services/participant.service';
import { LocationService } from './location.service';
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
    private participantService: ParticipantService,
    private locationService: LocationService,
    private configService: ConfigService,
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
   * Handle location update from client
   */
  @SubscribeMessage('location-update')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: LocationUpdateDto,
  ) {
    const userId = client.data.userId;

    try {
      // Process the location update
      const result = await this.locationService.processLocationUpdate(
        userId,
        payload,
      );

      if (!result.success) {
        // Throttled - don't broadcast
        return;
      }

      // Send acknowledgment to sender
      client.emit('location-update-ack', {
        sequenceNumber: result.sequenceNumber,
        priority: result.priority,
        timestamp: Date.now(),
      });

      // Broadcast to all participants in the journey
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

      // Send arrival notification if detected
      if (result.arrivalDetected) {
        this.server
          .to(`journey:${payload.journeyId}`)
          .emit('arrival-detected', {
            userId,
            timestamp: Date.now(),
          });
      }
    } catch (error) {
      client.emit('error', {
        message: error.message || 'Failed to process location update',
        timestamp: Date.now(),
      });
    }
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
