import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { notificationTypeEnum } from './enums';
import { journeys } from './journeys';
import { users } from './users';

// NOTIFICATIONS — replaces collectionGroup reads + the 1000-doc scan workaround.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => users.id),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_notif_recipient').on(t.recipientId, t.createdAt.desc()),
    index('idx_notif_unread')
      .on(t.recipientId)
      .where(sql`read = false`),
  ],
);
