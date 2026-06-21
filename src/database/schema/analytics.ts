import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { journeys } from './journeys';

export interface JourneyAnalyticsStats {
  leaderStops?: number;
  avgFollowerLag?: number;
  connectionDrops?: number;
}

// JOURNEY ANALYTICS — 1:1 with journey (journey_id is the PK).
export const journeyAnalytics = pgTable('journey_analytics', {
  journeyId: uuid('journey_id')
    .primaryKey()
    .references(() => journeys.id, { onDelete: 'cascade' }),
  startTime: timestamp('start_time', { withTimezone: true }),
  endTime: timestamp('end_time', { withTimezone: true }),
  totalDuration: doublePrecision('total_duration'),
  totalDistance: doublePrecision('total_distance'),
  averageSpeed: doublePrecision('average_speed'),
  maxLagDistance: doublePrecision('max_lag_distance'),
  lagAlertCount: integer('lag_alert_count').notNull().default(0),
  participantCount: integer('participant_count').notNull().default(0),
  // kept as-is for parity; LineString upgrade optional (plan §7)
  routePolyline: text('route_polyline'),
  stats: jsonb('stats').$type<JourneyAnalyticsStats>().notNull().default({}),
});
