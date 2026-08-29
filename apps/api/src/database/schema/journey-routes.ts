import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
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
import { journeyRouteReasonEnum } from './enums';
import { journeys } from './journeys';
import { users } from './users';

export interface JourneyRouteStep {
  instruction: string;
  distanceMetres: number;
  maneuver: string;
}

export const journeyRoutes = pgTable(
  'journey_routes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    geometry: jsonb('geometry').$type<number[][]>().notNull(),
    distanceMetres: doublePrecision('distance_metres').notNull(),
    durationSeconds: doublePrecision('duration_seconds').notNull(),
    steps: jsonb('steps').$type<JourneyRouteStep[]>().notNull().default([]),
    origin: geographyPoint('origin').notNull(),
    destination: geographyPoint('destination').notNull(),
    reason: journeyRouteReasonEnum('reason').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    requestId: uuid('request_id').notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('idx_journey_routes_version').on(t.journeyId, t.version),
    uniqueIndex('idx_journey_routes_request').on(t.journeyId, t.requestId),
    uniqueIndex('idx_journey_routes_current')
      .on(t.journeyId)
      .where(sql`is_current`),
    index('idx_journey_routes_history').on(t.journeyId, t.createdAt.desc()),
  ],
);
