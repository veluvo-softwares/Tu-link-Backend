import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// USERS — PK = Firebase Auth UID (keeps Postgres aligned with Firebase Auth +
// Redis keys; invariant A). Do NOT use a surrogate uuid here.
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    phoneNumber: text('phone_number'),
    emailVerified: boolean('email_verified').notNull().default(false),
    phoneVerified: boolean('phone_verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLogout: timestamp('last_logout', { withTimezone: true }),
  },
  (t) => [
    index('idx_users_email_lower').on(sql`lower(${t.email})`),
    index('idx_users_name_trgm').using(
      'gin',
      sql`${t.displayName} gin_trgm_ops`,
    ),
    index('idx_users_email_trgm').using('gin', sql`${t.email} gin_trgm_ops`),
  ],
);

// FCM TOKENS — replaces the FieldValue.arrayUnion embedded array on the user doc.
export const fcmTokens = pgTable(
  'fcm_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull().default('unknown'),
    deviceId: text('device_id'),
    registeredAt: timestamp('registered_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique('fcm_tokens_user_id_token_unique').on(t.userId, t.token)],
);
