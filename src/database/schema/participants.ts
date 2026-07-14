import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  connectionStatusEnum,
  participantRoleEnum,
  participantStatusEnum,
} from './enums';
import { journeys } from './journeys';
import { users } from './users';

export interface ParticipantDeviceInfo {
  platform: string;
  appVersion: string;
}

// PARTICIPANTS — participant identity = user_id (invariant A). Composite PK
// (journey_id, user_id) replaces the Firestore doc-id-as-userId uniqueness.
export const participants = pgTable(
  'participants',
  {
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: participantRoleEnum('role').notNull(),
    status: participantStatusEnum('status').notNull(),
    invitedBy: text('invited_by').references(() => users.id),
    connectionStatus: connectionStatusEnum('connection_status')
      .notNull()
      .default('DISCONNECTED'),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    leftAt: timestamp('left_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    convergedAt: timestamp('converged_at', { withTimezone: true }),
    deviceInfo: jsonb('device_info').$type<ParticipantDeviceInfo>(),
  },
  (t) => [
    primaryKey({ columns: [t.journeyId, t.userId] }),
    // replaces collectionGroup('participants').where('userId','==',u)
    index('idx_participants_user').on(t.userId, t.status),
  ],
);
