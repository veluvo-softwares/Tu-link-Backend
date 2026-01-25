import { Timestamp, GeoPoint } from 'firebase-admin/firestore';
import { Priority } from '../../types/priority.type';

export interface LocationHistory {
  id: string;
  journeyId: string;
  participantId: string;
  userId: string;
  location: GeoPoint;
  accuracy: number;
  heading?: number;
  speed?: number;
  altitude?: number;
  timestamp: Timestamp;
  sequenceNumber: number;
  priority: Priority;
  metadata: {
    batteryLevel?: number;
    isMoving: boolean;
  };
}

export interface LocationUpdate {
  journeyId: string;
  participantId: string;
  userId: string;
  location: {
    latitude: number;
    longitude: number;
  };
  accuracy: number;
  heading?: number;
  speed?: number;
  altitude?: number;
  timestamp: number;
  sequenceNumber?: number;
  priority?: Priority;
  metadata?: {
    batteryLevel?: number;
    isMoving?: boolean;
    statusChange?: boolean;
  };
}

export interface CachedLocation {
  journeyId: string;
  participantId: string;
  userId: string;
  location: {
    latitude: number;
    longitude: number;
  };
  accuracy: number;
  heading?: number;
  speed?: number;
  altitude?: number;
  timestamp: number;
  sequenceNumber?: number;
  priority?: Priority;
  metadata?: {
    batteryLevel?: number;
    isMoving?: boolean;
    statusChange?: boolean;
  };
}
