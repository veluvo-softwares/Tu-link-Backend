import {
  ParticipantRole,
  ParticipantStatus,
  ConnectionStatus,
} from '../../types/participant-status.type';

export interface Participant {
  id: string;
  userId: string;
  journeyId: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  joinedAt?: Date;
  leftAt?: Date;
  invitedBy?: string;
  lastSeenAt?: Date;
  arrivedAt?: Date;
  convergedAt?: Date;
  connectionStatus: ConnectionStatus;
  displayName?: string;
  deviceInfo?: {
    platform: string;
    appVersion: string;
  };
}
