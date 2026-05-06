import { Timestamp } from 'firebase-admin/firestore';
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
  joinedAt?: Timestamp;
  leftAt?: Timestamp;
  invitedBy: string;
  lastSeenAt?: Timestamp;
  connectionStatus: ConnectionStatus;
  displayName?: string;
  deviceInfo?: {
    platform: string;
    appVersion: string;
  };
}
