import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../../shared/firebase/firebase.service';
import { RedisService } from '../../../shared/redis/redis.service';
import { MapsService } from '../../maps/services/maps.service';
import {
  LocationUpdate,
  CachedLocation,
} from '../../../shared/interfaces/location.interface';
import { Journey } from '../../../shared/interfaces/journey.interface';
import { LagAlert } from '../../../shared/interfaces/notification.interface';
import { LagSeverity } from '../../../types/notification.type';
import { DistanceUtils } from '../../../common/utils/distance.utils';
import {
  FieldValue,
  GeoPoint,
  DocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

interface LagAlertData {
  journeyId: string;
  participantId: string;
  userId: string;
  distanceFromLeader: number;
  leaderLocation: GeoPoint;
  followerLocation: GeoPoint;
  severity: LagSeverity;
  isActive: boolean;
  createdAt: Timestamp;
}

@Injectable()
export class LagDetectionService {
  constructor(
    private firebaseService: FirebaseService,
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
        userId: followerUpdate.userId,
        distanceFromLeader: distance,
        leaderLocation: new GeoPoint(
          leaderLocation.location.latitude,
          leaderLocation.location.longitude,
        ),
        followerLocation: new GeoPoint(
          followerUpdate.location.latitude,
          followerUpdate.location.longitude,
        ),
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
   * Create a new lag alert in Firestore
   */
  private async createLagAlert(data: {
    journeyId: string;
    participantId: string;
    userId: string;
    distanceFromLeader: number;
    leaderLocation: GeoPoint;
    followerLocation: GeoPoint;
    severity: LagSeverity;
  }): Promise<LagAlert> {
    const alertRef = this.firebaseService.firestore
      .collection('journeys')
      .doc(data.journeyId)
      .collection('lag_alerts')
      .doc();

    const alertData: LagAlertData = {
      journeyId: data.journeyId,
      participantId: data.participantId,
      userId: data.userId,
      distanceFromLeader: data.distanceFromLeader,
      leaderLocation: data.leaderLocation,
      followerLocation: data.followerLocation,
      severity: data.severity,
      isActive: true,
      createdAt: FieldValue.serverTimestamp() as Timestamp,
    };

    await alertRef.set(alertData);

    return { id: alertRef.id, ...alertData } as LagAlert;
  }

  /**
   * Resolve active lag alerts when participant catches up
   */
  private async resolveActiveLagAlerts(
    journeyId: string,
    participantId: string,
  ): Promise<void> {
    const snapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('lag_alerts')
      .where('participantId', '==', participantId)
      .where('isActive', '==', true)
      .get();

    const updates = snapshot.docs.map((doc: DocumentSnapshot) =>
      doc.ref.update({
        isActive: false,
        resolvedAt: FieldValue.serverTimestamp(),
      }),
    );

    await Promise.all(updates);
  }

  /**
   * Get active lag alerts for a journey
   */
  async getActiveLagAlerts(journeyId: string): Promise<LagAlert[]> {
    const snapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('lag_alerts')
      .where('isActive', '==', true)
      .get();

    return snapshot.docs.map((doc: DocumentSnapshot) => ({
      id: doc.id,
      ...doc.data(),
    })) as LagAlert[];
  }

  /**
   * Acknowledge a lag alert (mark as seen by user)
   */
  async acknowledgeLagAlert(alertId: string, journeyId: string): Promise<void> {
    await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('lag_alerts')
      .doc(alertId)
      .update({
        acknowledgedAt: FieldValue.serverTimestamp(),
      });
  }
}
