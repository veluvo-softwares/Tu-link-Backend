import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { geogPoint, selectLat, selectLng } from '../../common/utils/geo.utils';
import { Priority } from '../../types/priority.type';
import { LatLng } from '../schema/columns/geography-point';
import { DatabaseService } from '../database.service';
import { LocationMetadata, locations } from '../schema';

export interface LocationRecord {
  id: number;
  journeyId: string;
  participantId: string;
  location: LatLng;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  altitude: number | null;
  sequenceNumber: number | null;
  priority: Priority;
  metadata: LocationMetadata;
  createdAt: Date;
}

export interface AppendLocationInput {
  journeyId: string;
  participantId: string;
  location: LatLng;
  accuracy?: number;
  heading?: number;
  speed?: number;
  altitude?: number;
  sequenceNumber?: number;
  priority?: Priority;
  metadata?: LocationMetadata;
}

type SelectedRow = {
  id: number;
  journeyId: string;
  participantId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  altitude: number | null;
  sequenceNumber: number | null;
  priority: Priority;
  metadata: LocationMetadata;
  createdAt: Date;
};

const toRecord = (row: SelectedRow): LocationRecord => {
  const { lat, lng, ...rest } = row;
  return { ...rest, location: { latitude: lat, longitude: lng } };
};

@Injectable()
export class LocationRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  private selection() {
    return {
      id: locations.id,
      journeyId: locations.journeyId,
      participantId: locations.participantId,
      lat: selectLat(locations.location),
      lng: selectLng(locations.location),
      accuracy: locations.accuracy,
      heading: locations.heading,
      speed: locations.speed,
      altitude: locations.altitude,
      sequenceNumber: locations.sequenceNumber,
      priority: locations.priority,
      metadata: locations.metadata,
      createdAt: locations.createdAt,
    };
  }

  // High-write append log. location written via geogPoint (axis flip in geo.utils).
  async append(input: AppendLocationInput): Promise<void> {
    await this.db.insert(locations).values({
      journeyId: input.journeyId,
      participantId: input.participantId,
      location: geogPoint(input.location.latitude, input.location.longitude),
      accuracy: input.accuracy,
      heading: input.heading,
      speed: input.speed,
      altitude: input.altitude,
      sequenceNumber: input.sequenceNumber ?? 0,
      priority: input.priority ?? 'LOW',
      metadata: input.metadata ?? {},
    });
  }

  // Latest row per participant for a journey, in one query (DISTINCT ON uses
  // idx_loc_latest). Replaces the per-participant Firestore query loop.
  async getLatestPerParticipant(journeyId: string): Promise<LocationRecord[]> {
    const rows = await this.db
      .selectDistinctOn([locations.participantId], this.selection())
      .from(locations)
      .where(eq(locations.journeyId, journeyId))
      .orderBy(locations.participantId, desc(locations.createdAt));
    return rows.map(toRecord);
  }

  async getLastForParticipant(
    journeyId: string,
    participantId: string,
  ): Promise<LocationRecord | null> {
    const [row] = await this.db
      .select(this.selection())
      .from(locations)
      .where(
        and(
          eq(locations.journeyId, journeyId),
          eq(locations.participantId, participantId),
        ),
      )
      .orderBy(desc(locations.createdAt))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async getParticipantHistory(
    journeyId: string,
    participantId: string,
    limit: number,
  ): Promise<LocationRecord[]> {
    const rows = await this.db
      .select(this.selection())
      .from(locations)
      .where(
        and(
          eq(locations.journeyId, journeyId),
          eq(locations.participantId, participantId),
        ),
      )
      .orderBy(desc(locations.createdAt))
      .limit(limit);
    return rows.map(toRecord);
  }

  // Resync: everything after a sequence number, ascending.
  async getSinceSequence(
    journeyId: string,
    fromSequence: number,
  ): Promise<LocationRecord[]> {
    const rows = await this.db
      .select(this.selection())
      .from(locations)
      .where(
        and(
          eq(locations.journeyId, journeyId),
          gt(locations.sequenceNumber, fromSequence),
        ),
      )
      .orderBy(asc(locations.sequenceNumber));
    return rows.map(toRecord);
  }
}
