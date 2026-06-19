import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../shared/redis/redis.service';
import { LagAlertRepository } from '../../../database/repositories/lag-alert.repository';
import { MapsService } from '../../maps/services/maps.service';
import {
  LocationUpdate,
  CachedLocation,
} from '../../../shared/interfaces/location.interface';
import { Journey } from '../../../shared/interfaces/journey.interface';
import { LagAlert } from '../../../shared/interfaces/notification.interface';
import { LagSeverity } from '../../../types/notification.type';
import { LatLng } from '../../../database/schema/columns/geography-point';
import { DistanceUtils } from '../../../common/utils/distance.utils';

@Injectable()
export class LagDetectionService {
  constructor(
    private lagAlertRepository: LagAlertRepository,
    private redisService: RedisService,
    private mapsService: MapsService,
    private configService: ConfigService,
  ) {}

  /**
   * Detect lag for a follower update
   */
  async detectLag(
    followerUpdate: LocationUpdate,
    journey: Journey,
  ): Promise<LagAlert | null> {
    // Get leader's latest location from Redis cache
    const leaderId = await this.redisService.getJourneyLeader(journey.id);
    if (!leaderId) {
      return null;
    }

    const leaderLocation: CachedLocation | null =
      await this.redisService.getCachedLocation(journey.id, leaderId);

    if (!leaderLocation) {
      return null;
    }

    // Calculate distance using Haversine formula
    const leaderCoords = {
      latitude: leaderLocation.location.latitude,
      longitude: leaderLocation.location.longitude,
    };

    const distance = DistanceUtils.haversineDistance(
      followerUpdate.location,
      leaderCoords,
    );

    // Check if distance exceeds threshold
    if (distance > journey.lagThresholdMeters) {
      const severity = this.calculateSeverity(distance);

      // Create or update lag alert
      return await this.createLagAlert({
        journeyId: journey.id,
        participantId: followerUpdate.participantId,
        distanceFromLeader: distance,
        leaderLocation: {
          latitude: leaderLocation.location.latitude,
          longitude: leaderLocation.location.longitude,
        },
        followerLocation: {
          latitude: followerUpdate.location.latitude,
          longitude: followerUpdate.location.longitude,
        },
        severity,
      });
    }

    // Check if there's an active alert that should be resolved
    await this.resolveActiveLagAlerts(journey.id, followerUpdate.participantId);

    return null;
  }

  /**
   * Calculate lag severity based on distance
   */
  private calculateSeverity(distance: number): LagSeverity {
    const criticalThreshold =
      this.configService.get<number>('app.criticalLagMeters') ?? 1000;
    return distance > criticalThreshold ? 'CRITICAL' : 'WARNING';
  }

  /**
   * Create a new lag alert in Postgres
   */
  private async createLagAlert(data: {
    journeyId: string;
    participantId: string;
    distanceFromLeader: number;
    leaderLocation: LatLng;
    followerLocation: LatLng;
    severity: LagSeverity;
  }): Promise<LagAlert> {
    const alert = await this.lagAlertRepository.create({
      journeyId: data.journeyId,
      participantId: data.participantId,
      distanceFromLeader: data.distanceFromLeader,
      leaderLocation: data.leaderLocation,
      followerLocation: data.followerLocation,
      severity: data.severity,
    });

    return alert as unknown as LagAlert;
  }

  /**
   * Resolve active lag alerts when participant catches up
   */
  private async resolveActiveLagAlerts(
    journeyId: string,
    participantId: string,
  ): Promise<void> {
    await this.lagAlertRepository.resolveActiveForParticipant(
      journeyId,
      participantId,
    );
  }

  /**
   * Get active lag alerts for a journey
   */
  async getActiveLagAlerts(journeyId: string): Promise<LagAlert[]> {
    const alerts = await this.lagAlertRepository.getActive(journeyId);
    return alerts as unknown as LagAlert[];
  }

  /**
   * Acknowledge a lag alert (mark as seen by user)
   */
  async acknowledgeLagAlert(alertId: string, journeyId: string): Promise<void> {
    await this.lagAlertRepository.acknowledge(alertId, journeyId);
  }
}
