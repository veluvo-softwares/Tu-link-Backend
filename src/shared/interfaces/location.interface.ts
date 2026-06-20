import { Priority } from '../../types/priority.type';

export interface LocationHistory {
  id: string;
  journeyId: string;
  participantId: string;
  userId: string;
  location: { latitude: number; longitude: number };
  accuracy: number;
  heading?: number;
  speed?: number;
  altitude?: number;
  timestamp: Date;
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

export interface LocationHistoryResponse {
  locations: LocationHistory[];
  destination?: {
    latitude: number;
    longitude: number;
  };
  destinationAddress?: string;
}

export interface LatestLocationsResponse {
  participants: Record<string, LocationUpdate>;
  destination?: {
    latitude: number;
    longitude: number;
  };
  destinationAddress?: string;
}
