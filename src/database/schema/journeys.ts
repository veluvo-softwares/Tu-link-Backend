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
}

export const journeys = pgTable(
  'journeys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    leaderId: text('leader_id')
      .notNull()
      .references(() => users.id),
    status: journeyStatusEnum('status').notNull().default('PENDING'),
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
    uniqueIndex('idx_journeys_one_open_per_leader')
      .on(t.leaderId)
      .where(sql`status IN ('PENDING', 'ACTIVE')`),
  ],
);
