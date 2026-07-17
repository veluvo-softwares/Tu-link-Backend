import { pgEnum } from 'drizzle-orm/pg-core';

// Enum values mirror the TS string unions in src/types/* byte-for-byte.
// The TS types are the source of truth; see notes below where they diverge
// from the migration plan's §4 DDL.

// src/types/journey-status.type.ts
export const journeyStatusEnum = pgEnum('journey_status', [
  'PENDING',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
]);

// src/types/participant-status.type.ts (ParticipantRole)
export const participantRoleEnum = pgEnum('participant_role', [
  'LEADER',
  'FOLLOWER',
]);

// src/types/participant-status.type.ts (ParticipantStatus)
// NOTE: order follows the TS type (DECLINED before ACTIVE/ARRIVED); the plan
// listed the same set in a different order. The value SET is identical.
export const participantStatusEnum = pgEnum('participant_status', [
  'INVITED',
  'ACCEPTED',
  'DECLINED',
  'ACTIVE',
  'ARRIVED',
  'LEFT',
]);

// src/types/participant-status.type.ts (ConnectionStatus)
export const connectionStatusEnum = pgEnum('connection_status', [
  'CONNECTED',
  'DISCONNECTED',
  'RECONNECTING',
]);

// src/types/priority.type.ts
export const priorityEnum = pgEnum('priority', ['LOW', 'MEDIUM', 'HIGH']);

// src/types/notification.type.ts (NotificationType)
// NOTE: includes PARTICIPANT_LEFT, which the plan's §4 DDL omitted. The TS
// type is the source of truth, so it is included here.
export const notificationTypeEnum = pgEnum('notification_type', [
  'JOURNEY_INVITE',
  'JOURNEY_STARTED',
  'JOURNEY_ENDED',
  'LAG_ALERT',
  'PARTICIPANT_JOINED',
  'PARTICIPANT_LEFT',
  'ARRIVAL_DETECTED',
  'CONVOY_JOINED',
  'JOURNEY_REMINDER',
  'JOURNEY_STARTING_NOW',
  'JOURNEY_MISSED_START',
]);

// src/types/notification.type.ts (LagSeverity)
export const lagSeverityEnum = pgEnum('lag_severity', ['WARNING', 'CRITICAL']);
