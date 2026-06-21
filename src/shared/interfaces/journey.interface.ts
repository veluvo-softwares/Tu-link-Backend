import { JourneyStatus } from '../../types/journey-status.type';

export interface Journey {
  id: string;
  name: string;
  leaderId: string;
  status: JourneyStatus;
  startTime?: Date;
  endTime?: Date;
  destination?: { latitude: number; longitude: number };
  destinationAddress?: string;
  lagThresholdMeters: number;
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    totalDistance?: number;
    estimatedDuration?: number;
  };
}
