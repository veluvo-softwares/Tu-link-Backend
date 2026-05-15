/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Injectable,
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
import { ArrivalDetectionService } from './services/arrival-detection.service';
import { LocationUpdateDto } from './dto/location-update.dto';
import {
  LocationUpdate,
  LocationHistory,
  LocationHistoryResponse,
  LatestLocationsResponse,
} from '../../shared/interfaces/location.interface';
import { Priority } from '../../types/priority.type';
import { FieldValue, GeoPoint } from 'firebase-admin/firestore';

interface RTDBLocationData {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number | null;
  speed?: number | null;
  altitude?: number | null;
  timestamp: number;
  userId: string;
  sequenceNumber?: number;
  priority?: string;
  metadata?: {
    batteryLevel?: number | null;
    isMoving?: boolean | null;
    statusChange?: boolean | string | null;
  };
}

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
    arrivalDetected?: boolean;
  }> {
    const { journeyId } = locationUpdateDto;

    console.error(
      `LocationService: Processing update for userId: ${userId}, journeyId: ${journeyId}`,
    );

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

    // 7. Check throttling
    const lastUpdateTime = lastLocation?.timestamp?.toMillis() || null;
    const shouldThrottle = this.priorityService.shouldThrottle(
      locationUpdateDto as LocationUpdate,
      priority,
      lastUpdateTime,
    );

    const shouldThrottleForBattery =
      this.priorityService.shouldThrottleForBattery(
        locationUpdateDto as LocationUpdate,
        priority,
      );

    if (shouldThrottle || shouldThrottleForBattery) {
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

    // 10. Store in RTDB (primary live source) - awaited
    const rtdbPayload = {
      lat: locationUpdateDto.location.latitude,
      lng: locationUpdateDto.location.longitude,
      accuracy: locationUpdateDto.accuracy,
      heading: locationUpdateDto.heading ?? null,
      speed: locationUpdateDto.speed ?? null,
      altitude: locationUpdateDto.altitude ?? null,
      timestamp: locationUpdateDto.timestamp,
      userId,
      sequenceNumber,
      priority,
      metadata: {
        batteryLevel: locationUpdateDto.metadata?.batteryLevel ?? null,
        isMoving: locationUpdateDto.metadata?.isMoving ?? null,
        statusChange: locationUpdateDto.metadata?.statusChange ?? null,
      },
    };
    await this.firebaseService.setMemberPosition(
      journeyId,
      userId,
      rtdbPayload,
    );

    // 11. Store in Firestore (persistence) - fire-and-forget
    this.persistToFirestore(locationUpdate).catch((err: Error) =>
      console.error(
        `Firestore persist failed for user ${userId}: ${err.message}`,
        err.stack,
      ),
    );

    // 12. Update Redis cache (hot data)
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
    const arrivalDetected = await this.arrivalDetectionService.detectArrival(
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

      arrivalDetected,
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
    let locations: Record<string, LocationUpdate> = {};

    // Strategy 1: Try RTDB first (most recent real-time data)
    try {
      const rtdbData =
        await this.firebaseService.getJourneyRTDBSnapshot(journeyId);
      if (rtdbData && Object.keys(rtdbData).length > 0) {
        console.log(
          `RTDB: Found ${Object.keys(rtdbData).length} real-time locations for journey ${journeyId}`,
        );
        locations = await this.transformRTDBToLocationUpdates(
          journeyId,
          rtdbData,
        );

        // If we got RTDB data, use it and skip Redis fallback
        if (Object.keys(locations).length > 0) {
          return this.buildLatestLocationsResponse(locations, journey);
        }
      } else {
        console.log(
          `RTDB: No active participants found for journey ${journeyId}`,
        );
      }
    } catch (error) {
      console.error(
        `RTDB read failed for journey ${journeyId}, falling back to Redis:`,
        error,
      );
    }

    // Strategy 2: Fallback to Redis cache (existing behavior)
    console.log(`Falling back to Redis cache for journey ${journeyId}`);
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
      throw new BadRequestException('Journey is not active');
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
   * Transform RTDB data structure to LocationUpdate format
   * RTDB format: { userId: { lat, lng, accuracy, heading, speed, timestamp, ... } }
   * API format: { participantId: LocationUpdate }
   */
  private async transformRTDBToLocationUpdates(
    journeyId: string,
    rtdbData: Record<string, Record<string, unknown>>,
  ): Promise<Record<string, LocationUpdate>> {
    const locations: Record<string, LocationUpdate> = {};

    // Get participants to map userId to participantId
    const participants =
      await this.participantService.getJourneyParticipants(journeyId);
    const userToParticipantMap = new Map<string, string>();
    participants.forEach((p) => userToParticipantMap.set(p.userId, p.id));

    for (const [userId, data] of Object.entries(rtdbData)) {
      const participantId = userToParticipantMap.get(userId);
      if (!participantId || !data) continue;

      // Cast to our expected interface for type safety
      const locationData = data as unknown as RTDBLocationData;

      locations[participantId] = {
        journeyId,
        participantId,
        location: {
          latitude: locationData.lat,
          longitude: locationData.lng,
        },
        accuracy: locationData.accuracy || 0,
        heading: locationData.heading || null,
        speed: locationData.speed || null,
        altitude: locationData.altitude || null,
        timestamp: locationData.timestamp,
        sequenceNumber: locationData.sequenceNumber || 0,
        priority: locationData.priority || 'LOW',
        metadata: {
          batteryLevel: locationData.metadata?.batteryLevel || null,
          isMoving: locationData.metadata?.isMoving || null,
          statusChange:
            typeof locationData.metadata?.statusChange === 'string'
              ? locationData.metadata?.statusChange === 'true'
              : locationData.metadata?.statusChange || false,
        },
      } as LocationUpdate;
    }

    return locations;
  }

  /**
   * Get locations updated since a specific timestamp (for polling strategy)
   */
  async getLocationsSince(
    journeyId: string,
    sinceTimestamp: number,
    userId: string,
  ): Promise<LatestLocationsResponse> {
    try {
      // Verify user is a participant
      const isParticipant = await this.participantService.isParticipant(
        journeyId,
        userId,
      );
      if (!isParticipant) {
        throw new ForbiddenException(
          'User is not a participant in this journey',
        );
      }

      // Get journey destination info
      const journey = await this.journeyService.findById(journeyId);

      // Try RTDB first
      const rtdbLocations = await this.firebaseService.getLocationsSince(
        journeyId,
        sinceTimestamp,
      );

      if (Object.keys(rtdbLocations).length > 0) {
        // Transform RTDB data to LocationUpdate format
        const locations = await this.transformRTDBToLocationUpdates(
          journeyId,
          rtdbLocations,
        );

        return {
          participants: locations,
          destination: journey?.destination
            ? {
                latitude: journey.destination.latitude,
                longitude: journey.destination.longitude,
              }
            : undefined,
          destinationAddress: journey?.destinationAddress,
        };
      }

      // Fallback to Redis if RTDB is empty
      const redisLocations = await this.getLatestLocations(journeyId, userId);

      // Filter Redis locations by timestamp
      const filteredParticipants: Record<string, LocationUpdate> = {};
      for (const [participantId, location] of Object.entries(
        redisLocations.participants,
      )) {
        if (location.timestamp > sinceTimestamp) {
          filteredParticipants[participantId] = location;
        }
      }

      return {
        participants: filteredParticipants,
        destination: redisLocations.destination,
        destinationAddress: redisLocations.destinationAddress,
      };
    } catch (error) {
      console.error('Error getting locations since timestamp:', error);
      throw error;
    }
  }
}
