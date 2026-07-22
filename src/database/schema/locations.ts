import {
  bigint,
  boolean,
  doublePrecision,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { geographyPoint } from './columns/geography-point';
import { priorityEnum } from './enums';
import { journeys } from './journeys';
import { participants } from './participants';

export interface LocationMetadata {
  batteryLevel?: number;
  isMoving?: boolean;
  backfilled?: boolean;
}

// LOCATIONS — high-write append log; live reads still come from Redis.
// bigint identity PK is cheaper than uuid for an append log.
// participant_id is text = user_id (invariant A).
export const locations = pgTable(
  'locations',
  {
    id: bigint('id', { mode: 'number' })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    participantId: text('participant_id').notNull(),
    location: geographyPoint('location').notNull(),
    accuracy: doublePrecision('accuracy'),
    heading: doublePrecision('heading'),
    speed: doublePrecision('speed'),
    altitude: doublePrecision('altitude'),
    sequenceNumber: bigint('sequence_number', { mode: 'number' }),
    priority: priorityEnum('priority').notNull().default('LOW'),
    metadata: jsonb('metadata').$type<LocationMetadata>().notNull().default({}),
    // Event time reported by the GPS sample. This is distinct from ingestion
    // time so an offline trail keeps its real chronology after backfill.
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientPointId: text('client_point_id'),
    backfilled: boolean('backfilled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.journeyId, t.participantId],
      foreignColumns: [participants.journeyId, participants.userId],
    }).onDelete('cascade'),
    index('idx_loc_latest').on(
      t.journeyId,
      t.participantId,
      t.createdAt.desc(),
    ),
    index('idx_loc_seq').on(t.journeyId, t.sequenceNumber),
    index('idx_loc_recorded').on(
      t.journeyId,
      t.participantId,
      t.recordedAt.desc(),
    ),
    uniqueIndex('idx_loc_client_point')
      .on(t.journeyId, t.participantId, t.clientPointId)
      .where(sql`client_point_id IS NOT NULL`),
    // Optional once spatial history queries appear:
    // index('idx_loc_geo').using('gist', t.location),
  ],
);
