import { JourneyStatus } from '../../types/journey-status.type';

export interface Journey {
  id: string;
  inviteCode: string;
  name: string;
  leaderId: string;
  organizationId?: string | null;
  status: JourneyStatus;
  scheduledFor?: Date;
  startTime?: Date;
  endTime?: Date;
  destination?: { latitude: number; longitude: number };
  /** Place name; absent on journeys created before the column existed. */
  destinationName?: string;
  destinationAddress?: string;
  lagThresholdMeters: number;
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    totalDistance?: number;
    estimatedDuration?: number;
    autoStart?: boolean;
    remindersSent?: string[];
  };
}
