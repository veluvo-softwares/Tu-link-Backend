/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { JourneyAnalytics } from '../../shared/interfaces/analytics.interface';
import { LocationHistory } from '../../shared/interfaces/location.interface';
import { Journey } from '../../shared/interfaces/journey.interface';
import { DistanceUtils } from '../../common/utils/distance.utils';
import { FieldValue } from 'firebase-admin/firestore';

@Injectable()
export class AnalyticsService {
  constructor(private firebaseService: FirebaseService) {}

  /**
   * Calculate and store analytics when a journey ends
   */
  async calculateJourneyAnalytics(
    journeyId: string,
  ): Promise<JourneyAnalytics> {
    // Get journey data
    const journeyDoc = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .get();

    if (!journeyDoc.exists) {
      throw new Error('Journey not found');
    }

    const journey = { id: journeyDoc.id, ...journeyDoc.data() } as Journey;

    // Get all location updates for this journey
    const locationsSnapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('locations')
      .orderBy('timestamp', 'asc')
      .get();

    const locations = locationsSnapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as LocationHistory,
    );

    // Get all lag alerts
    const lagAlertsSnapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('lag_alerts')
      .get();

    // Get participant count
    const participantsSnapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .get();

    // Calculate metrics
    const totalDistance = this.calculateTotalDistance(locations);
    const averageSpeed = this.calculateAverageSpeed(locations);
    const maxLagDistance = this.calculateMaxLagDistance(lagAlertsSnapshot.docs);
    const lagAlertCount = lagAlertsSnapshot.size;
    const participantCount = participantsSnapshot.size;
    const stats = this.calculateStats(locations);

    // Calculate duration
    const startTime = journey.startTime;
    const endTime = journey.endTime;
    const totalDuration =
      startTime && endTime
        ? (endTime.toMillis() - startTime.toMillis()) / 1000
        : 0;

    // Create analytics document
    const analyticsData = {
      journeyId,
      startTime: journey.startTime || (FieldValue.serverTimestamp() as any),
      endTime: journey.endTime,
      totalDuration,
      totalDistance,
      averageSpeed,
      maxLagDistance,
      lagAlertCount,
      participantCount,
      routePolyline: this.encodeRoutePolyline(locations),
      stats,
    };

    // Store in Firestore
    await this.firebaseService.firestore
      .collection('analytics')
      .doc(journeyId)
      .set(analyticsData);

    return { id: journeyId, ...analyticsData } as JourneyAnalytics;
  }

  /**
   * Get analytics for a specific journey
   */
  async getJourneyAnalytics(
    journeyId: string,
  ): Promise<JourneyAnalytics | null> {
    const analyticsDoc = await this.firebaseService.firestore
      .collection('analytics')
      .doc(journeyId)
      .get();

    if (!analyticsDoc.exists) {
      return null;
    }

    return { id: analyticsDoc.id, ...analyticsDoc.data() } as JourneyAnalytics;
  }

  /**
   * Get user's journey history with analytics
   */
  async getUserJourneyHistory(
    userId: string,
    limit: number = 20,
  ): Promise<any[]> {
    // Get all journeys where user was a participant
    const participantsSnapshot = await this.firebaseService.firestore
      .collectionGroup('participants')
      .where('userId', '==', userId)
      .get();

    const journeyIds = new Set(
      participantsSnapshot.docs
        .map((doc) => doc.ref.parent.parent?.id)
        .filter((id): id is string => id !== undefined),
    );

    const journeys: any[] = [];

    for (const journeyId of Array.from(journeyIds).slice(0, limit)) {
      const journeyDoc = await this.firebaseService.firestore
        .collection('journeys')
        .doc(journeyId)
        .get();

      if (!journeyDoc.exists) continue;

      const journey = { id: journeyDoc.id, ...journeyDoc.data() };

      // Get analytics if available
      const analytics = await this.getJourneyAnalytics(journeyId);

      journeys.push({
        ...journey,
        analytics,
      });
    }

    // Sort by creation date
    journeys.sort((a, b) => {
      const aTime = a.createdAt?.toMillis() || 0;
      const bTime = b.createdAt?.toMillis() || 0;
      return bTime - aTime;
    });

    return journeys;
  }

  /**
   * Calculate total distance traveled
   */
  private calculateTotalDistance(locations: LocationHistory[]): number {
    if (locations.length < 2) return 0;

    let totalDistance = 0;

    for (let i = 1; i < locations.length; i++) {
      const prev = locations[i - 1];
      const curr = locations[i];

      const distance = DistanceUtils.haversineDistance(
        {
          latitude: prev.location.latitude,
          longitude: prev.location.longitude,
        },
        {
          latitude: curr.location.latitude,
          longitude: curr.location.longitude,
        },
      );

      totalDistance += distance;
    }

    return totalDistance;
  }

  /**
   * Calculate average speed
   */
  private calculateAverageSpeed(locations: LocationHistory[]): number {
    if (locations.length === 0) return 0;

    const speeds = locations
      .filter((loc) => loc.speed !== undefined && loc.speed > 0)
      .map((loc) => loc.speed!)
      .filter((speed): speed is number => speed !== undefined);

    if (speeds.length === 0) return 0;

    const sum = speeds.reduce((acc, speed) => acc + speed, 0);
    return sum / speeds.length;
  }

  /**
   * Calculate maximum lag distance
   */
  private calculateMaxLagDistance(lagAlerts: any[]): number {
    if (lagAlerts.length === 0) return 0;

    return Math.max(
      ...lagAlerts.map((alert) => alert.data().distanceFromLeader || 0),
    );
  }

  /**
   * Calculate additional statistics
   */
  private calculateStats(locations: LocationHistory[]): {
    leaderStops: number;
    avgFollowerLag: number;
    connectionDrops: number;
  } {
    // Count stops (speed close to 0 for extended period)
    const leaderLocations = locations.filter(
      (loc) => loc.metadata?.isMoving === false,
    );
    const leaderStops = leaderLocations.length;

    // Calculate average follower lag (simplified)
    const avgFollowerLag = 0; // Would need to compare follower vs leader positions over time

    // Connection drops (would need connection state history)
    const connectionDrops = 0;

    return {
      leaderStops,
      avgFollowerLag,
      connectionDrops,
    };
  }

  /**
   * Encode route as polyline (simplified version)
   */
  private encodeRoutePolyline(locations: LocationHistory[]): string {
    // Simplified: just store as JSON string
    // In production, use proper polyline encoding algorithm
    const points = locations.map((loc) => ({
      lat: loc.location.latitude,
      lng: loc.location.longitude,
    }));

    return JSON.stringify(points);
  }
}
