import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from './columns/geography-point';
import { journeyStatusEnum } from './enums';
import { users } from './users';

export interface JourneyMetadata {
  totalDistance?: number;
  estimatedDuration?: number;
  /** Scheduled journeys: start automatically at scheduled_for (vs. nudge the leader). */
  autoStart?: boolean;
  /** Reminder ladder dedupe — tier keys already sent (e.g. '24h', '1h', '15m', 'start-due', 'missed-nudge'). */
  remindersSent?: string[];
}

export const journeys = pgTable(
  'journeys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inviteCode: text('invite_code').notNull(),
    name: text('name').notNull(),
    leaderId: text('leader_id')
      .notNull()
      .references(() => users.id),
    status: journeyStatusEnum('status').notNull().default('PENDING'),
    // When set on a PENDING journey, the journey is "scheduled": the cron in
    // JourneySchedulerService sends the reminder ladder and handles start at
    // this instant. NULL = start-now journey (existing behavior).
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    startTime: timestamp('start_time', { withTimezone: true }),
    endTime: timestamp('end_time', { withTimezone: true }),
    destination: geographyPoint('destination'),
    destinationAddress: text('destination_address'),
    lagThresholdMeters: integer('lag_threshold_meters').notNull().default(500),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb('metadata').$type<JourneyMetadata>().notNull().default({}),
  },
  (t) => [
    index('idx_journeys_leader').on(t.leaderId),
    index('idx_journeys_status').on(t.status),
    index('idx_journeys_dest').using('gist', t.destination),
    uniqueIndex('idx_journeys_invite_code').on(t.inviteCode),
    uniqueIndex('idx_journeys_one_open_per_leader')
      .on(t.leaderId)
      .where(sql`status IN ('PENDING', 'ACTIVE')`),
    // Cron scan for due scheduled journeys stays narrow: only pending rows
    // that actually have a schedule.
    index('idx_journeys_scheduled')
      .on(t.scheduledFor)
      .where(sql`status = 'PENDING' AND scheduled_for IS NOT NULL`),
  ],
);
