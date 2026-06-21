export interface JourneyAnalytics {
  id: string;
  journeyId: string;
  startTime: Date;
  endTime?: Date;
  totalDuration?: number;
  totalDistance: number;
  averageSpeed: number;
  maxLagDistance: number;
  lagAlertCount: number;
  participantCount: number;
  routePolyline?: string;
  stats: {
    leaderStops: number;
    avgFollowerLag: number;
    connectionDrops: number;
  };
}
