import { Injectable } from '@nestjs/common';
import { JourneyAnalytics } from '../../shared/interfaces/analytics.interface';
import { DistanceUtils } from '../../common/utils/distance.utils';
import { AnalyticsRepository } from '../../database/repositories/analytics.repository';
import { JourneyRepository } from '../../database/repositories/journey.repository';
import {
  LocationRecord,
  LocationRepository,
} from '../../database/repositories/location.repository';
import { LagAlertRepository } from '../../database/repositories/lag-alert.repository';
import { ParticipantRepository } from '../../database/repositories/participant.repository';

@Injectable()
export class AnalyticsService {
  constructor(
    private analyticsRepository: AnalyticsRepository,
    private journeyRepository: JourneyRepository,
    private locationRepository: LocationRepository,
    private lagAlertRepository: LagAlertRepository,
    private participantRepository: ParticipantRepository,
  ) {}

  /**
   * Calculate and store analytics when a journey ends
   */
  async calculateJourneyAnalytics(
    journeyId: string,
  ): Promise<JourneyAnalytics> {
    const journey = await this.journeyRepository.findById(journeyId);
    if (!journey) {
      throw new Error('Journey not found');
    }

    // All location updates for this journey, oldest first
    const locations = await this.locationRepository.getAllForJourney(journeyId);

    // Route metrics (distance, speed, stops, polyline) describe the journey's
    // path, so they must run over a single participant's track. Mixing every
    // participant's rows (interleaved by createdAt) produces meaningless
    // jumps between people. Use the leader's locations as the canonical route.
    const leaderLocations = locations.filter(
      (loc) => loc.participantId === journey.leaderId,
    );

    // All lag alerts + participant rows
    const lagAlerts = await this.lagAlertRepository.getByJourney(journeyId);
    const participants =
      await this.participantRepository.findByJourney(journeyId);

    // Calculate metrics
    const totalDistance = this.calculateTotalDistance(leaderLocations);
    const averageSpeed = this.calculateAverageSpeed(leaderLocations);
    const maxLagDistance = this.calculateMaxLagDistance(lagAlerts);
    const lagAlertCount = lagAlerts.length;
    const participantCount = participants.length;
    const stats = this.calculateStats(leaderLocations);

    // Calculate duration
    const startTime = journey.startTime;
    const endTime = journey.endTime;
    const totalDuration =
      startTime && endTime
        ? (endTime.getTime() - startTime.getTime()) / 1000
        : 0;

    const analytics = await this.analyticsRepository.upsert({
      journeyId,
      startTime: journey.startTime,
      endTime: journey.endTime,
      totalDuration,
      totalDistance,
      averageSpeed,
      maxLagDistance,
      lagAlertCount,
      participantCount,
      routePolyline: this.encodeRoutePolyline(leaderLocations),
      stats,
    });

    return analytics as unknown as JourneyAnalytics;
  }

  /**
   * Get analytics for a specific journey
   */
  async getJourneyAnalytics(
    journeyId: string,
  ): Promise<JourneyAnalytics | null> {
    const analytics = await this.analyticsRepository.findByJourneyId(journeyId);
    return analytics as unknown as JourneyAnalytics | null;
  }

  /**
   * Get user's journey history with analytics
   */
  async getUserJourneyHistory(
    userId: string,
    limit: number = 20,
  ): Promise<any[]> {
    // 1) All journey IDs where the user was a participant (replaces
    //    collectionGroup('participants')).
    const participations = await this.participantRepository.findByUser(userId);
    const journeyIds = Array.from(
      new Set(participations.map((p) => p.journeyId)),
    );

    if (journeyIds.length === 0) return [];

    // 2) Fetch every journey in parallel, drop any that no longer exist.
    const journeyResults = await Promise.all(
      journeyIds.map((id) => this.journeyRepository.findById(id)),
    );

    // 3) Sort by createdAt desc BEFORE slicing so the most recent journeys
    //    survive the limit.
    const sortedJourneys = journeyResults
      .filter((journey): journey is NonNullable<typeof journey> => !!journey)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);

    // 4) Batch-fetch analytics for the limited set (one query) and key by id.
    const analyticsList = await this.analyticsRepository.findByJourneyIds(
      sortedJourneys.map((j) => j.id),
    );
    const analyticsByJourney = new Map(
      analyticsList.map((a) => [a.journeyId, a]),
    );

    return sortedJourneys.map((journey) => {
      const analytics = analyticsByJourney.get(journey.id);
      // The list endpoint omits routePolyline (can be ~30 KB per journey and
      // the history list doesn't render it). Clients that need it fetch the
      // full doc via GET /analytics/journeys/:id.
      const listAnalytics = analytics
        ? // eslint-disable-next-line @typescript-eslint/no-unused-vars
          (({ routePolyline, ...rest }) => rest)(analytics)
        : null;
      return { ...journey, analytics: listAnalytics };
    });
  }

  /**
   * Calculate total distance traveled
   */
  private calculateTotalDistance(locations: LocationRecord[]): number {
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
  private calculateAverageSpeed(locations: LocationRecord[]): number {
    if (locations.length === 0) return 0;

    const speeds = locations
      .map((loc) => loc.speed)
      .filter((speed): speed is number => speed != null && speed > 0);

    if (speeds.length === 0) return 0;

    const sum = speeds.reduce((acc, speed) => acc + speed, 0);
    return sum / speeds.length;
  }

  /**
   * Calculate maximum lag distance
   */
  private calculateMaxLagDistance(
    lagAlerts: { distanceFromLeader: number }[],
  ): number {
    if (lagAlerts.length === 0) return 0;

    return Math.max(...lagAlerts.map((alert) => alert.distanceFromLeader || 0));
  }

  /**
   * Calculate additional statistics
   */
  private calculateStats(locations: LocationRecord[]): {
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
  private encodeRoutePolyline(locations: LocationRecord[]): string {
    // Simplified: just store as JSON string
    // In production, use proper polyline encoding algorithm
    const points = locations.map((loc) => ({
      lat: loc.location.latitude,
      lng: loc.location.longitude,
    }));

    return JSON.stringify(points);
  }
}
