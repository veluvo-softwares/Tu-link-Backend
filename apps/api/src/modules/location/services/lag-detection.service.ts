import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../shared/redis/redis.service';
import {
  LagAlertRecord,
  LagAlertRepository,
} from '../../../database/repositories/lag-alert.repository';
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
import { LoggerService } from '../../../shared/logger/logger.service';
import { ParticipantRepository } from '../../../database/repositories/participant.repository';
import { NotificationService } from '../../notification/notification.service';

// Maps the repository row to the API LagAlert shape (the row carries
// `Date | null` for the resolved/acknowledged timestamps; the interface uses
// optional `Date`).
const toLagAlert = (record: LagAlertRecord): LagAlert => ({
  id: record.id,
  journeyId: record.journeyId,
  participantId: record.participantId,
  distanceFromLeader: record.distanceFromLeader,
  leaderLocation: record.leaderLocation,
  followerLocation: record.followerLocation,
  severity: record.severity,
  isActive: record.isActive,
  createdAt: record.createdAt,
  resolvedAt: record.resolvedAt ?? undefined,
  acknowledgedAt: record.acknowledgedAt ?? undefined,
});

@Injectable()
export class LagDetectionService {
  constructor(
    private lagAlertRepository: LagAlertRepository,
    private redisService: RedisService,
    private mapsService: MapsService,
    private configService: ConfigService,
    private participantRepository: ParticipantRepository,
    private notificationService: NotificationService,
    private logger: LoggerService,
  ) {}

  /**
   * Detect lag for a follower update
   */
  async detectLag(
    followerUpdate: LocationUpdate,
    journey: Journey,
    participant: { convergedAt?: Date | null },
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

    // Convergence gate (D-04/D-06/D-07, NOTIF-16): skip all lag evaluation
    // for a participant who has never joined the group. Reuses the distance
    // already computed above — no second Haversine call needed.
    if (!participant.convergedAt) {
      const rendezvousRadius =
        this.configService.get<number>('app.rendezvousRadiusMeters') ?? 300;
      if (distance <= rendezvousRadius) {
        const updated =
          await this.participantRepository.setConvergedIfNotConverged(
            journey.id,
            followerUpdate.participantId,
          );
        if (updated) {
          this.notificationService
            .sendConvoyJoined(
              journey.id,
              followerUpdate.participantId,
              journey.lagThresholdMeters,
            )
            .catch((error: Error) => {
              this.logger.warn(
                `Convoy-joined notification failed for journey ${journey.id}, participant ${followerUpdate.participantId}: ${error.message}`,
                'LagDetectionService',
              );
            });
        }
      }
      return null;
    }

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
    const alert = await this.lagAlertRepository.upsertActiveForParticipant({
      journeyId: data.journeyId,
      participantId: data.participantId,
      distanceFromLeader: data.distanceFromLeader,
      leaderLocation: data.leaderLocation,
      followerLocation: data.followerLocation,
      severity: data.severity,
    });

    return toLagAlert(alert);
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
    return alerts.map(toLagAlert);
  }

  /**
   * Acknowledge a lag alert (mark as seen by user)
   */
  async acknowledgeLagAlert(alertId: string, journeyId: string): Promise<void> {
    await this.lagAlertRepository.acknowledge(alertId, journeyId);
  }
}
