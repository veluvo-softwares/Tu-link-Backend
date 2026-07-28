export type ParticipantStatus =
  | 'INVITED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'ACTIVE'
  | 'ARRIVED'
  | 'LEFT';

export type ParticipantRole = 'LEADER' | 'FOLLOWER';

export type ConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING';
