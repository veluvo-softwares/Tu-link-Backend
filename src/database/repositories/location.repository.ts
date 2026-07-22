import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, max } from 'drizzle-orm';
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
  recordedAt: Date;
  receivedAt: Date;
  clientPointId: string | null;
  backfilled: boolean;
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
  recordedAt?: Date;
  receivedAt?: Date;
  clientPointId?: string;
  backfilled?: boolean;
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
  recordedAt: Date;
  receivedAt: Date;
  clientPointId: string | null;
  backfilled: boolean;
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
      recordedAt: locations.recordedAt,
      receivedAt: locations.receivedAt,
      clientPointId: locations.clientPointId,
      backfilled: locations.backfilled,
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
      recordedAt: input.recordedAt ?? new Date(),
      receivedAt: input.receivedAt ?? new Date(),
      clientPointId: input.clientPointId,
      backfilled: input.backfilled ?? false,
    });
  }

  /**
   * Append a client-identified point exactly once. Returns false when the
   * point was already committed by an earlier delivery whose ack was lost.
   */
  async appendIdempotent(input: AppendLocationInput): Promise<boolean> {
    if (!input.clientPointId) {
      throw new Error('clientPointId is required for idempotent append');
    }

    const inserted = await this.db
      .insert(locations)
      .values({
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
        recordedAt: input.recordedAt ?? new Date(),
        receivedAt: input.receivedAt ?? new Date(),
        clientPointId: input.clientPointId,
        backfilled: input.backfilled ?? false,
      })
      .onConflictDoNothing()
      .returning({ id: locations.id });

    return inserted.length === 1;
  }

  async getMaxSequence(journeyId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: max(locations.sequenceNumber) })
      .from(locations)
      .where(eq(locations.journeyId, journeyId));
    return row?.value ?? 0;
  }

  // Latest row per participant for a journey, in one query (DISTINCT ON uses
  // idx_loc_latest). Replaces the per-participant Firestore query loop.
  async getLatestPerParticipant(journeyId: string): Promise<LocationRecord[]> {
    const rows = await this.db
      .selectDistinctOn([locations.participantId], this.selection())
      .from(locations)
      .where(eq(locations.journeyId, journeyId))
      .orderBy(locations.participantId, desc(locations.recordedAt));
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
      .orderBy(desc(locations.recordedAt))
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
      .orderBy(desc(locations.recordedAt))
      .limit(limit);
    return rows.map(toRecord);
  }

  // All locations for a journey, oldest first — used for analytics (distance,
  // speed, route). High-write table, so this is an end-of-journey read.
  async getAllForJourney(journeyId: string): Promise<LocationRecord[]> {
    const rows = await this.db
      .select(this.selection())
      .from(locations)
      .where(eq(locations.journeyId, journeyId))
      .orderBy(asc(locations.recordedAt));
    return rows.map(toRecord);
  }

  // Resync: everything after a sequence number, ascending.
  async getSinceSequence(
    journeyId: string,
    fromSequence: number,
    limit: number = 500,
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
      .orderBy(asc(locations.sequenceNumber))
      .limit(limit);
    return rows.map(toRecord);
  }
}
