import {
  boolean,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from './columns/geography-point';
import { lagSeverityEnum } from './enums';
import { journeys } from './journeys';

// LAG ALERTS — participant_id is text = user_id (invariant A).
export const lagAlerts = pgTable(
  'lag_alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    participantId: text('participant_id').notNull(),
    distanceFromLeader: doublePrecision('distance_from_leader').notNull(),
    leaderLocation: geographyPoint('leader_location').notNull(),
    followerLocation: geographyPoint('follower_location').notNull(),
    severity: lagSeverityEnum('severity').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  },
  (t) => [index('idx_lag_active').on(t.journeyId, t.participantId, t.isActive)],
);
