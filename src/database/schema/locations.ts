import {
  bigint,
  doublePrecision,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from './columns/geography-point';
import { priorityEnum } from './enums';
import { journeys } from './journeys';
import { participants } from './participants';

export interface LocationMetadata {
  batteryLevel?: number;
  isMoving?: boolean;
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
    // Optional once spatial history queries appear:
    // index('idx_loc_geo').using('gist', t.location),
  ],
);
