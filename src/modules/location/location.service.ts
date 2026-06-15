/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Injectable,
  Inject,
  forwardRef,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { RedisService } from '../../shared/redis/redis.service';
import { JourneyService } from '../journey/journey.service';
import { ParticipantService } from '../journey/services/participant.service';
import { PriorityService } from './services/priority.service';
import { SequenceService } from './services/sequence.service';
import { AcknowledgmentService } from './services/acknowledgment.service';
import { LagDetectionService } from './services/lag-detection.service';
import {
  ArrivalDetectionService,
  ArrivalResult,
} from './services/arrival-detection.service';
import { LocationUpdateDto } from './dto/location-update.dto';
import {
  LocationUpdate,
  LocationHistory,
  LocationHistoryResponse,
  LatestLocationsResponse,
} from '../../shared/interfaces/location.interface';
import { Priority } from '../../types/priority.type';
import { FieldValue, GeoPoint } from 'firebase-admin/firestore';

interface Journey {
  destination?: {
    latitude: number;
    longitude: number;
  };
  destinationAddress?: string;
}

@Injectable()
export class LocationService {
  constructor(
    private firebaseService: FirebaseService,
    private redisService: RedisService,
    @Inject(forwardRef(() => JourneyService))
    private journeyService: JourneyService,
    private participantService: ParticipantService,
    private priorityService: PriorityService,
    private sequenceService: SequenceService,
    private acknowledgmentService: AcknowledgmentService,
    private lagDetectionService: LagDetectionService,
    private arrivalDetectionService: ArrivalDetectionService,
    private configService: ConfigService,
  ) {}

  /**
   * Process a location update from a participant
   * This is the main entry point for location updates
   */
  async processLocationUpdate(
    userId: string,
    locationUpdateDto: LocationUpdateDto,
  ): Promise<{
    success: boolean;
    sequenceNumber: number;
    priority: Priority;
    shouldBroadcast: boolean;
    lagAlert?: any;
    arrival?: ArrivalResult;
  }> {
    const { journeyId, location } = locationUpdateDto;

    // Deduplicate identical updates arriving simultaneously via HTTP + WebSocket.
    // Key encodes user, journey, and rounded coords so genuine moves aren't dropped.
    const dedupKey = `dedup:loc:${userId}:${journeyId}:${location?.latitude?.toFixed(5)}:${location?.longitude?.toFixed(5)}`;
    const alreadyProcessing = await this.redisService
      .getClient()
      .set(dedupKey, '1', 'EX', 2, 'NX');
    if (!alreadyProcessing) {
      return {
        success: false,
        sequenceNumber: 0,
        priority: 'LOW' as any,
        shouldBroadcast: false,
      };
    }

    // 1. Validate participant membership and journey status
    await this.validateParticipant(userId, journeyId);

    // 2. Check rate limiting
    const rateLimitPassed = await this.checkRateLimit(userId);
    if (!rateLimitPassed) {
      throw new BadRequestException('Rate limit exceeded');
    }

    // 3. Get journey and participant info
    const journey = await this.journeyService.findById(journeyId);
    const participants =
      await this.participantService.getJourneyParticipants(journeyId);
    const participant = participants.find((p) => p.userId === userId);

    if (!participant) {
      throw new ForbiddenException('Not a participant of this journey');
    }

    // 4. Get last location for this participant
    const lastLocation =
      (await this.getLastLocation(journeyId, participant.id)) || undefined;

    // 5. Get leader's location (for lag detection)
    let leaderLocation: LocationUpdate | undefined = undefined;
    if (participant.role === 'FOLLOWER') {
      const leaderId = await this.redisService.getJourneyLeader(journeyId);
      if (leaderId) {
        leaderLocation =
          (await this.redisService.getCachedLocation(journeyId, leaderId)) ||
          undefined;
      }
    }

    // 6. Calculate priority
    const priority = this.priorityService.calculatePriority(
      locationUpdateDto as LocationUpdate,
      journey,
      participant,
      lastLocation,
      leaderLocation,
    );

    // 7. Check throttling. Battery-level throttling was intentionally removed:
    // modern phones cope fine at low battery and we don't want to drop a
    // member off the map just because their battery is low.
    const lastUpdateTime = lastLocation?.timestamp?.toMillis() || null;
    const shouldThrottle = this.priorityService.shouldThrottle(
      locationUpdateDto as LocationUpdate,
      priority,
      lastUpdateTime,
    );

    if (shouldThrottle) {
      return {
        success: false,
        sequenceNumber: 0,
        priority,
        shouldBroadcast: false,
      };
    }

    // 8. Generate sequence number
    const sequenceNumber =
      await this.sequenceService.getNextSequence(journeyId);

    // 9. Prepare location update object
    const locationUpdate: LocationUpdate = {
      ...locationUpdateDto,
      participantId: participant.id,
      sequenceNumber,
      priority,
      timestamp: Date.now(),
    };

    // 10. Store in Firestore (persistence) - fire-and-forget
    this.persistToFirestore(locationUpdate).catch((err: Error) =>
      console.error(
        `Firestore persist failed for user ${userId}: ${err.message}`,
        err.stack,
      ),
    );

    // 11. Update Redis cache — the single source of truth for live convoy
    // positions and the snapshot returned to clients on join. Must be awaited
    // so a join-time snapshot read immediately after sees this position.
    await this.redisService.cacheLocation(
      journeyId,
      participant.id,
      locationUpdate,
    );

    // 13. Detect lag (for followers only)
    let lagAlert: any = undefined;
    if (participant.role === 'FOLLOWER') {
      lagAlert = await this.lagDetectionService.detectLag(
        locationUpdate,
        journey,
      );
    }

    // 14. Detect arrival
    const arrival = await this.arrivalDetectionService.detectArrival(
      locationUpdate,
      journey,
    );

    // 15. Add to pending deliveries if HIGH priority
    if (this.acknowledgmentService.requiresAcknowledgment(priority)) {
      const journeyParticipants =
        await this.redisService.getJourneyParticipants(journeyId);
      for (const participantId of journeyParticipants) {
        if (participantId !== participant.id) {
          await this.acknowledgmentService.addPendingDelivery(
            journeyId,
            participantId,
            locationUpdate,
          );
        }
      }
    }

    return {
      success: true,
      sequenceNumber,
      priority,
      shouldBroadcast: true,

      lagAlert,
      arrival,
    };
  }

  /**
   * Persists location to Firestore for history and analytics.
   * Called asynchronously — failures are logged but do not affect the live update response.
   */
  private async persistToFirestore(update: LocationUpdate): Promise<void> {
    const locationRef = this.firebaseService.firestore
      .collection('journeys')
      .doc(update.journeyId)
      .collection('locations')
      .doc();

    const locationData = {
      journeyId: update.journeyId,
      participantId: update.participantId,
      location: new GeoPoint(
        update.location.latitude,
        update.location.longitude,
      ),
      accuracy: update.accuracy,
      heading: update.heading,
      speed: update.speed,
      altitude: update.altitude,

      timestamp: FieldValue.serverTimestamp() as any,
      sequenceNumber: update.sequenceNumber || 0,
      priority: update.priority || 'LOW',
      metadata: {
        batteryLevel: update.metadata?.batteryLevel,
        isMoving: update.metadata?.isMoving || false,
      },
    };

    await locationRef.set(locationData);
  }

  /**
   * Get latest location per participant for a journey
   */
  async getLocationHistory(
    journeyId: string,
    userId: string,
  ): Promise<LocationHistoryResponse> {
    // Verify user is a participant
    const isParticipant = await this.participantService.isParticipant(
      journeyId,
      userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('Not a participant of this journey');
    }

    // Get journey details for destination information
    const journey = await this.journeyService.findById(journeyId);

    // Get all participants in the journey
    const participants =
      await this.participantService.getJourneyParticipants(journeyId);

    // Get latest location for each participant
    const latestLocations: LocationHistory[] = [];

    for (const participant of participants) {
      const snapshot = await this.firebaseService.firestore
        .collection('journeys')
        .doc(journeyId)
        .collection('locations')
        .where('participantId', '==', participant.id)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (!snapshot.empty) {
        const locationData = snapshot.docs[0].data();
        latestLocations.push({
          id: snapshot.docs[0].id,
          ...locationData,
        } as LocationHistory);
      }
    }

    // Sort by timestamp descending (most recent first)
    latestLocations.sort((a, b) => {
      const aTime = a.timestamp?.toMillis?.() || 0;
      const bTime = b.timestamp?.toMillis?.() || 0;
      return bTime - aTime;
    });

    // Prepare response with destination coordinates
    const response: {
      locations: LocationHistory[];
      destination?: { latitude: number; longitude: number };
      destinationAddress?: string;
    } = {
      locations: latestLocations,
    };

    if (journey.destination) {
      response.destination = {
        latitude: journey.destination.latitude,
        longitude: journey.destination.longitude,
      };
    }

    if (journey.destinationAddress) {
      response.destinationAddress = journey.destinationAddress;
    }

    return response;
  }

  /**
   * Get latest locations for all participants in a journey
   */
  async getLatestLocations(
    journeyId: string,
    userId: string,
  ): Promise<LatestLocationsResponse> {
    // Verify user is a participant
    const isParticipant = await this.participantService.isParticipant(
      journeyId,
      userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('Not a participant of this journey');
    }

    // Get journey details for destination information
    const journey = await this.journeyService.findById(journeyId);
    const locations: Record<string, LocationUpdate> = {};

    // Read the latest cached position for each participant from Redis — the
    // single source of truth for live convoy positions.
    const participants =
      await this.redisService.getJourneyParticipants(journeyId);

    for (const participantId of participants) {
      const location = await this.redisService.getCachedLocation(
        journeyId,
        participantId,
      );
      if (location) {
        locations[participantId] = location;
      }
    }

    return this.buildLatestLocationsResponse(locations, journey);
  }

  /**
   * Build the final response object with participants and journey details
   */
  private buildLatestLocationsResponse(
    participants: Record<string, LocationUpdate>,
    journey: Journey,
  ): LatestLocationsResponse {
    const response: {
      participants: Record<string, LocationUpdate>;
      destination?: { latitude: number; longitude: number };
      destinationAddress?: string;
    } = {
      participants,
    };

    if (journey.destination) {
      response.destination = {
        latitude: journey.destination.latitude,
        longitude: journey.destination.longitude,
      };
    }

    if (journey.destinationAddress) {
      response.destinationAddress = journey.destinationAddress;
    }

    return response;
  }

  /**
   * Get location history for a specific participant
   */
  async getParticipantLocationHistory(
    journeyId: string,
    participantId: string,
    userId: string,
    limit: number = 50,
  ): Promise<LocationHistory[]> {
    // Verify user is a participant
    const isParticipant = await this.participantService.isParticipant(
      journeyId,
      userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('Not a participant of this journey');
    }

    const snapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('locations')
      .where('participantId', '==', participantId)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as LocationHistory[];
  }

  /**
   * Handle acknowledgment of a location update
   */
  async handleAcknowledgment(
    userId: string,
    journeyId: string,
    sequenceNumber: number,
  ): Promise<void> {
    const participants =
      await this.participantService.getJourneyParticipants(journeyId);
    const participant = participants.find((p) => p.userId === userId);

    if (!participant) {
      throw new ForbiddenException('Not a participant');
    }

    // Update last acknowledged sequence
    await this.sequenceService.updateLastAcknowledged(
      participant.id,
      sequenceNumber,
    );

    // Remove from pending deliveries
    await this.acknowledgmentService.removePendingDelivery(
      journeyId,
      participant.id,
    );
  }

  /**
   * Handle resync request (when client detects gaps)
   */
  async handleResyncRequest(
    userId: string,
    journeyId: string,
    fromSequence: number,
  ): Promise<LocationHistory[]> {
    const isParticipant = await this.participantService.isParticipant(
      journeyId,
      userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('Not a participant');
    }

    // Get all locations after the specified sequence number
    const snapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('locations')
      .where('sequenceNumber', '>', fromSequence)
      .orderBy('sequenceNumber', 'asc')
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as LocationHistory[];
  }

  /**
   * Validate participant can send location updates
   */
  private async validateParticipant(
    userId: string,
    journeyId: string,
  ): Promise<void> {
    const journey = await this.journeyService.findById(journeyId);

    if (journey.status !== 'ACTIVE') {
      throw new BadRequestException({
        message: 'Journey is not active',
        journeyStatus: journey.status,
        stopPolling: true,
      });
    }

    const isActive = await this.participantService.isActiveParticipant(
      journeyId,
      userId,
    );
    if (!isActive) {
      throw new ForbiddenException('Not an active participant of this journey');
    }
  }

  /**
   * Check rate limiting
   */
  private async checkRateLimit(userId: string): Promise<boolean> {
    const limit = this.configService.get('app.locationUpdateRateLimit') || 10;

    const window = this.configService.get('app.locationUpdateRateWindow') || 60;
    const key = `ratelimit:location:${userId}`;

    return await this.redisService.checkRateLimit(key, limit, window);
  }

  /**
   * Get last location for a participant
   */
  private async getLastLocation(
    journeyId: string,
    participantId: string,
  ): Promise<LocationHistory | null> {
    const snapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('locations')
      .where('participantId', '==', participantId)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const data = snapshot.docs[0].data();
    return {
      id: snapshot.docs[0].id,
      ...data,
    } as LocationHistory;
  }

  /**
   * Get locations updated since a specific timestamp (for polling strategy).
   * Reads from Redis (the live source) and filters by timestamp.
   */
  async getLocationsSince(
    journeyId: string,
    sinceTimestamp: number,
    userId: string,
  ): Promise<LatestLocationsResponse> {
    // getLatestLocations performs the participant check and journey lookup.
    const latest = await this.getLatestLocations(journeyId, userId);

    const filteredParticipants: Record<string, LocationUpdate> = {};
    for (const [participantId, location] of Object.entries(
      latest.participants,
    )) {
      if (location.timestamp > sinceTimestamp) {
        filteredParticipants[participantId] = location;
      }
    }

    return {
      participants: filteredParticipants,
      destination: latest.destination,
      destinationAddress: latest.destinationAddress,
    };
  }
}
