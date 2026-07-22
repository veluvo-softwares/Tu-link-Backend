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
import { RedisService } from '../../shared/redis/redis.service';
import {
  LocationRecord,
  LocationRepository,
} from '../../database/repositories/location.repository';
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
  LocationBackfillAck,
  LocationBackfillDto,
  LocationBackfillPointDto,
} from './dto/location-backfill.dto';
import {
  LocationUpdate,
  LocationHistory,
  LocationHistoryResponse,
  LatestLocationsResponse,
} from '../../shared/interfaces/location.interface';
import { Priority } from '../../types/priority.type';

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
    private locationRepository: LocationRepository,
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
    const lastUpdateTime = lastLocation
      ? lastLocation.timestamp.getTime()
      : null;
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
      timestamp: locationUpdateDto.timestamp,
    };

    // 10. Persist before acknowledging or updating the live cache. A client
    // must be able to remove its locally queued point after the ack without a
    // Postgres failure creating a permanent history hole.
    const inserted = await this.persistLocation(locationUpdate);
    if (!inserted) {
      return {
        success: true,
        sequenceNumber,
        priority,
        shouldBroadcast: false,
      };
    }

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
        participant,
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
   * Persists location to Postgres for history and analytics.
   * Awaited by the live path so an acknowledgement means durable history.
   */
  private async persistLocation(update: LocationUpdate): Promise<boolean> {
    const input = {
      journeyId: update.journeyId,
      participantId: update.participantId,
      location: update.location,
      accuracy: update.accuracy,
      heading: update.heading,
      speed: update.speed,
      altitude: update.altitude,
      sequenceNumber: update.sequenceNumber || 0,
      priority: update.priority || 'LOW',
      metadata: {
        batteryLevel: update.metadata?.batteryLevel,
        isMoving: update.metadata?.isMoving || false,
      },
      recordedAt: new Date(update.timestamp),
      receivedAt: new Date(),
      clientPointId: update.clientPointId,
      backfilled: update.metadata?.backfilled ?? false,
    };
    if (update.clientPointId) {
      return this.locationRepository.appendIdempotent(input);
    }
    await this.locationRepository.append(input);
    return true;
  }

  // Maps a Postgres location row to the API LocationHistory shape. recordedAt
  // is the real GPS event time; receivedAt is retained for audit.
  private recordToHistory(record: LocationRecord): LocationHistory {
    return {
      id: String(record.id),
      journeyId: record.journeyId,
      participantId: record.participantId,
      userId: record.participantId,
      location: record.location,
      accuracy: record.accuracy ?? 0,
      heading: record.heading ?? undefined,
      speed: record.speed ?? undefined,
      altitude: record.altitude ?? undefined,
      timestamp: record.recordedAt,
      receivedAt: record.receivedAt,
      sequenceNumber: record.sequenceNumber ?? 0,
      priority: record.priority,
      metadata: {
        batteryLevel: record.metadata?.batteryLevel,
        isMoving: record.metadata?.isMoving ?? false,
        backfilled: record.backfilled,
      },
    } as unknown as LocationHistory;
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

    // Latest location per participant in a single query (DISTINCT ON), most
    // recent first.
    const latestRecords =
      await this.locationRepository.getLatestPerParticipant(journeyId);
    const latestLocations: LocationHistory[] = latestRecords
      .map((r) => this.recordToHistory(r))
      .sort(
        (a, b) =>
          new Date(b.timestamp as unknown as string).getTime() -
          new Date(a.timestamp as unknown as string).getTime(),
      );

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

    // Membership is durable in Postgres. Redis can restart or expire without
    // making an active participant disappear from the convoy snapshot.
    const participants = (
      await this.participantService.getJourneyParticipants(journeyId)
    ).filter(
      (participant) =>
        participant.role === 'LEADER' ||
        ['ACTIVE', 'ACCEPTED', 'ARRIVED'].includes(participant.status),
    );
    const durableLatest =
      await this.locationRepository.getLatestPerParticipant(journeyId);
    const durableByParticipant = new Map(
      durableLatest.map((record) => [record.participantId, record]),
    );

    for (const participant of participants) {
      const participantId = participant.userId;
      const location = await this.redisService.getCachedLocation(
        journeyId,
        participantId,
      );
      if (location) {
        locations[participantId] = {
          ...location,
          positionRecordedAt: location.timestamp,
          connectionState: participant.connectionStatus,
          lastSeenAt: participant.lastSeenAt?.getTime(),
        };
        continue;
      }

      const durable = durableByParticipant.get(participantId);
      if (durable) {
        locations[participantId] = {
          journeyId,
          participantId,
          location: durable.location,
          accuracy: durable.accuracy ?? 0,
          heading: durable.heading ?? undefined,
          speed: durable.speed ?? undefined,
          altitude: durable.altitude ?? undefined,
          timestamp: durable.recordedAt.getTime(),
          positionRecordedAt: durable.recordedAt.getTime(),
          sequenceNumber: durable.sequenceNumber ?? 0,
          priority: durable.priority,
          connectionState: participant.connectionStatus,
          lastSeenAt: participant.lastSeenAt?.getTime(),
          metadata: {
            batteryLevel: durable.metadata?.batteryLevel,
            isMoving: durable.metadata?.isMoving ?? false,
            backfilled: durable.backfilled,
          },
        };
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

    const records = await this.locationRepository.getParticipantHistory(
      journeyId,
      participantId,
      limit,
    );
    return records.map((r) => this.recordToHistory(r));
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
    requestedLimit: number = 500,
  ): Promise<{
    updates: LocationHistory[];
    nextSequence: number;
    hasMore: boolean;
  }> {
    const isParticipant = await this.participantService.isParticipant(
      journeyId,
      userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('Not a participant');
    }

    const limit = Math.min(Math.max(requestedLimit, 1), 500);
    // Fetch one extra row to tell the client whether another page is needed.
    const records = await this.locationRepository.getSinceSequence(
      journeyId,
      fromSequence,
      limit + 1,
    );
    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;
    const updates = page.map((record) => this.recordToHistory(record));
    return {
      updates,
      nextSequence:
        page.length > 0
          ? (page[page.length - 1].sequenceNumber ?? fromSequence)
          : fromSequence,
      hasMore,
    };
  }

  /**
   * Persist an offline trail exactly once. This deliberately bypasses live
   * throttling/rate limiting, but applies separate batch and time-window
   * limits. Each insert is awaited before it can be acknowledged.
   */
  async processBackfill(
    userId: string,
    dto: LocationBackfillDto,
  ): Promise<LocationBackfillAck> {
    const maxPoints =
      this.configService.get<number>('app.backfillMaxPoints') ?? 200;
    if (dto.points.length > maxPoints) {
      throw new BadRequestException(
        `Backfill batch exceeds ${maxPoints} points`,
      );
    }

    const backfillRateLimit =
      this.configService.get<number>('app.backfillBatchRateLimit') ?? 30;
    const withinBackfillRate = await this.redisService.checkRateLimit(
      `ratelimit:location-backfill:${userId}`,
      backfillRateLimit,
      60,
    );
    if (!withinBackfillRate) {
      throw new BadRequestException('Backfill rate limit exceeded');
    }

    const journey = await this.journeyService.findById(dto.journeyId);
    const participant = await this.participantService.getParticipant(
      dto.journeyId,
      userId,
    );
    if (!participant || !participant.joinedAt) {
      throw new ForbiddenException('Not a joined participant of this journey');
    }

    const now = Date.now();
    const completionGraceMs =
      (this.configService.get<number>('app.backfillCompletionGraceHours') ??
        24) *
      60 *
      60 *
      1000;
    const completedWithinGrace =
      journey.status === 'COMPLETED' &&
      journey.endTime != null &&
      now - journey.endTime.getTime() <= completionGraceMs;
    if (journey.status !== 'ACTIVE' && !completedWithinGrace) {
      throw new BadRequestException('Journey is not accepting backfill');
    }

    const acknowledgedPointIds: string[] = [];
    const acceptedPointIds: string[] = [];
    const duplicatePointIds: string[] = [];
    const rejected: Array<{ clientPointId: string; reason: string }> = [];
    const maxAgeMs =
      (this.configService.get<number>('app.backfillMaxPointAgeDays') ?? 7) *
      24 *
      60 *
      60 *
      1000;
    const futureSkewMs =
      (this.configService.get<number>('app.backfillFutureSkewSeconds') ?? 300) *
      1000;
    const journeyStartFloor = journey.startTime
      ? journey.startTime.getTime() - 5 * 60 * 1000
      : now - maxAgeMs;
    const journeyEndCeiling = journey.endTime
      ? journey.endTime.getTime() + futureSkewMs
      : now + futureSkewMs;

    let newestAccepted: LocationBackfillPointDto | null = null;
    let nextSequence = 0;

    // Client order is not trusted. Sequence valid history by event time so a
    // malformed/replayed payload cannot create an internally reversed page.
    const orderedPoints = [...dto.points].sort(
      (left, right) => left.recordedAt - right.recordedAt,
    );
    const seenPointIds = new Set<string>();
    for (const point of orderedPoints) {
      const invalidReason = this.validateBackfillTimestamp(
        point.recordedAt,
        now,
        maxAgeMs,
        futureSkewMs,
        journeyStartFloor,
        journeyEndCeiling,
      );
      if (invalidReason) {
        rejected.push({
          clientPointId: point.clientPointId,
          reason: invalidReason,
        });
        continue;
      }
      if (seenPointIds.has(point.clientPointId)) {
        duplicatePointIds.push(point.clientPointId);
        acknowledgedPointIds.push(point.clientPointId);
        continue;
      }
      seenPointIds.add(point.clientPointId);

      const sequenceNumber = await this.sequenceService.getNextSequence(
        dto.journeyId,
      );
      const inserted = await this.locationRepository.appendIdempotent({
        journeyId: dto.journeyId,
        participantId: userId,
        location: point.location,
        accuracy: point.accuracy,
        heading: point.heading,
        speed: point.speed,
        altitude: point.altitude,
        sequenceNumber,
        priority: 'LOW',
        recordedAt: new Date(point.recordedAt),
        receivedAt: new Date(),
        clientPointId: point.clientPointId,
        backfilled: true,
        metadata: {
          batteryLevel: point.metadata?.batteryLevel,
          isMoving: point.metadata?.isMoving ?? false,
          backfilled: true,
        },
      });

      acknowledgedPointIds.push(point.clientPointId);
      if (inserted) {
        acceptedPointIds.push(point.clientPointId);
        nextSequence = Math.max(nextSequence, sequenceNumber);
        if (
          newestAccepted == null ||
          point.recordedAt > newestAccepted.recordedAt
        ) {
          newestAccepted = point;
        }
      } else {
        duplicatePointIds.push(point.clientPointId);
      }
    }

    // Historical points are never rebroadcast. During an active journey only,
    // refresh the live cache from the newest accepted sample if it is newer.
    if (journey.status === 'ACTIVE' && newestAccepted) {
      const cached = await this.redisService.getCachedLocation(
        dto.journeyId,
        userId,
      );
      if (!cached || newestAccepted.recordedAt > cached.timestamp) {
        await this.redisService.cacheLocation(dto.journeyId, userId, {
          journeyId: dto.journeyId,
          participantId: userId,
          location: newestAccepted.location,
          accuracy: newestAccepted.accuracy,
          heading: newestAccepted.heading,
          speed: newestAccepted.speed,
          altitude: newestAccepted.altitude,
          timestamp: newestAccepted.recordedAt,
          positionRecordedAt: newestAccepted.recordedAt,
          sequenceNumber: nextSequence || undefined,
          priority: 'LOW',
          metadata: {
            batteryLevel: newestAccepted.metadata?.batteryLevel,
            isMoving: newestAccepted.metadata?.isMoving ?? false,
            backfilled: true,
          },
        });
      }
    }

    if (nextSequence === 0) {
      nextSequence = await this.locationRepository.getMaxSequence(
        dto.journeyId,
      );
    }

    return {
      batchId: dto.batchId,
      acknowledgedPointIds,
      acceptedPointIds,
      duplicatePointIds,
      rejected,
      nextSequence,
    };
  }

  private validateBackfillTimestamp(
    recordedAt: number,
    now: number,
    maxAgeMs: number,
    futureSkewMs: number,
    journeyStartFloor: number,
    journeyEndCeiling: number,
  ): string | null {
    if (!Number.isFinite(recordedAt)) return 'INVALID_TIMESTAMP';
    if (recordedAt < now - maxAgeMs) return 'POINT_TOO_OLD';
    if (recordedAt > now + futureSkewMs) return 'POINT_IN_FUTURE';
    if (recordedAt < journeyStartFloor) return 'BEFORE_JOURNEY_START';
    if (recordedAt > journeyEndCeiling) return 'AFTER_JOURNEY_END';
    return null;
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
    const record = await this.locationRepository.getLastForParticipant(
      journeyId,
      participantId,
    );
    return record ? this.recordToHistory(record) : null;
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
