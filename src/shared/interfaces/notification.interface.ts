import { Timestamp, GeoPoint } from 'firebase-admin/firestore';
import { NotificationType, LagSeverity } from '../../types/notification.type';

export interface Notification {
  id: string;
  journeyId: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, any>;
  read: boolean;
  createdAt: Timestamp;
  readAt?: Timestamp;
}

export interface LagAlert {
  id: string;
  journeyId: string;
  participantId: string;
  userId: string;
  distanceFromLeader: number;
  leaderLocation: GeoPoint;
  followerLocation: GeoPoint;
  severity: LagSeverity;
  isActive: boolean;
  createdAt: Timestamp;
  resolvedAt?: Timestamp;
  acknowledgedAt?: Timestamp;
}
