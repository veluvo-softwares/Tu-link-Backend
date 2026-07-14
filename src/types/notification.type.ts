export type NotificationType =
  | 'JOURNEY_INVITE'
  | 'JOURNEY_STARTED'
  | 'JOURNEY_ENDED'
  | 'LAG_ALERT'
  | 'PARTICIPANT_JOINED'
  | 'PARTICIPANT_LEFT'
  | 'ARRIVAL_DETECTED'
  | 'CONVOY_JOINED';

export type LagSeverity = 'WARNING' | 'CRITICAL';
