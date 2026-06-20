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
  createdAt: Date;
  readAt?: Date;
}

export interface LagAlert {
  id: string;
  journeyId: string;
  participantId: string;
  distanceFromLeader: number;
  leaderLocation: { latitude: number; longitude: number };
  followerLocation: { latitude: number; longitude: number };
  severity: LagSeverity;
  isActive: boolean;
  createdAt: Date;
  resolvedAt?: Date;
  acknowledgedAt?: Date;
}
