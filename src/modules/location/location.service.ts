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
} from '../../shared/interfaces/location.interface';
import { Priority } from '../../types/priority.type';
import { FieldValue, GeoPoint } from 'firebase-admin/firestore';

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
      userId,
      sequenceNumber,
      priority,
      timestamp: Date.now(),
    };

    // 10. Store in Firestore (persistence)
    await this.saveLocationToFirestore(locationUpdate);

    // 11. Update Redis cache (hot data)
    await this.redisService.cacheLocation(
      journeyId,
      participant.id,
      locationUpdate,
    );

    // 12. Detect lag (for followers only)
    let lagAlert: any = undefined;
    if (participant.role === 'FOLLOWER') {
      lagAlert = await this.lagDetectionService.detectLag(
        locationUpdate,
        journey,
      );
    }

    // 13. Detect arrival
    const arrivalDetected = await this.arrivalDetectionService.detectArrival(
      locationUpdate,
      journey,
    );

    // 14. Add to pending deliveries if HIGH priority
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
   * Save location update to Firestore
   */
  private async saveLocationToFirestore(update: LocationUpdate): Promise<void> {
    const locationRef = this.firebaseService.firestore
      .collection('journeys')
      .doc(update.journeyId)
      .collection('locations')
      .doc();

    const locationData = {
      journeyId: update.journeyId,
      participantId: update.participantId,
      userId: update.userId,
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
   * Get location history for a journey
   */
  async getLocationHistory(
    journeyId: string,
    userId: string,
    limit: number = 100,
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
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as LocationHistory[];
  }

  /**
   * Get latest locations for all participants in a journey
   */
  async getLatestLocations(
    journeyId: string,
    userId: string,
  ): Promise<Record<string, LocationUpdate>> {
    // Verify user is a participant
    const isParticipant = await this.participantService.isParticipant(
      journeyId,
      userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('Not a participant of this journey');
    }

    const participants =
      await this.redisService.getJourneyParticipants(journeyId);
    const locations: Record<string, LocationUpdate> = {};

    for (const participantId of participants) {
      const location = await this.redisService.getCachedLocation(
        journeyId,
        participantId,
      );
      if (location) {
        locations[participantId] = location;
      }
    }

    return locations;
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
}
