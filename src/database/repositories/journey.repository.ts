import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { geogPoint, selectLat, selectLng } from '../../common/utils/geo.utils';
import { JourneyStatus } from '../../types/journey-status.type';
import { LatLng } from '../schema/columns/geography-point';
import { DatabaseService } from '../database.service';
import * as schema from '../schema';
import { JourneyMetadata, journeys } from '../schema';

export interface JourneyRecord {
  id: string;
  name: string;
  leaderId: string;
  status: JourneyStatus;
  startTime: Date | null;
  endTime: Date | null;
  destination: LatLng | null;
  destinationAddress: string | null;
  lagThresholdMeters: number;
  createdAt: Date;
  updatedAt: Date;
  metadata: JourneyMetadata;
}

export interface CreateJourneyInput {
  name: string;
  leaderId: string;
  destination?: LatLng;
  destinationAddress?: string;
  lagThresholdMeters: number;
  metadata?: JourneyMetadata;
}

export interface UpdateJourneyInput {
  name?: string;
  destination?: LatLng;
  destinationAddress?: string;
  lagThresholdMeters?: number;
}

@Injectable()
export class JourneyRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  // Reads NEVER select the raw geography column — destination comes back as
  // lat/lng via the geo helpers (invariant B lives in geo.utils).
  private selection() {
    return {
      id: journeys.id,
      name: journeys.name,
      leaderId: journeys.leaderId,
      status: journeys.status,
      startTime: journeys.startTime,
      endTime: journeys.endTime,
      destinationLat: selectLat(journeys.destination),
      destinationLng: selectLng(journeys.destination),
      destinationAddress: journeys.destinationAddress,
      lagThresholdMeters: journeys.lagThresholdMeters,
      createdAt: journeys.createdAt,
      updatedAt: journeys.updatedAt,
      metadata: journeys.metadata,
    };
  }

  private toRecord(row: {
    id: string;
    name: string;
    leaderId: string;
    status: JourneyStatus;
    startTime: Date | null;
    endTime: Date | null;
    destinationLat: number | null;
    destinationLng: number | null;
    destinationAddress: string | null;
    lagThresholdMeters: number;
    createdAt: Date;
    updatedAt: Date;
    metadata: JourneyMetadata;
  }): JourneyRecord {
    const { destinationLat, destinationLng, ...rest } = row;
    return {
      ...rest,
      destination:
        destinationLat != null && destinationLng != null
          ? { latitude: destinationLat, longitude: destinationLng }
          : null,
    };
  }

  async create(input: CreateJourneyInput): Promise<JourneyRecord> {
    const [row] = await this.db
      .insert(journeys)
      .values({
        name: input.name,
        leaderId: input.leaderId,
        destination: input.destination
          ? geogPoint(input.destination.latitude, input.destination.longitude)
          : undefined,
        destinationAddress: input.destinationAddress,
        lagThresholdMeters: input.lagThresholdMeters,
        metadata: input.metadata ?? {},
      })
      .returning(this.selection());
    return this.toRecord(row);
  }

  async findById(journeyId: string): Promise<JourneyRecord | null> {
    const [row] = await this.db
      .select(this.selection())
      .from(journeys)
      .where(eq(journeys.id, journeyId))
      .limit(1);
    return row ? this.toRecord(row) : null;
  }

  // tx-aware read of the leader's current ACTIVE journey. This is a plain
  // SELECT under the default READ COMMITTED isolation -- it does NOT lock
  // the row and does NOT by itself prevent two concurrent transactions from
  // both observing "no active journey" and proceeding to the write. It is
  // only a fast-path / friendly-UX pre-check so the common case returns a
  // clean 409 without round-tripping through a unique-violation. The actual
  // race-safety guarantee comes from the partial unique index
  // (idx_journeys_one_active_per_leader) plus the caller's 23505 catch,
  // which is what serializes concurrent winners/losers. Do not remove the
  // 23505 handling on the assumption that this pre-check is sufficient.
  async findActiveByLeader(
    tx: NodePgDatabase<typeof schema>,
    leaderId: string,
  ): Promise<JourneyRecord | null> {
    const [row] = await tx
      .select(this.selection())
      .from(journeys)
      .where(
        and(eq(journeys.leaderId, leaderId), eq(journeys.status, 'ACTIVE')),
      )
      .limit(1);
    return row ? this.toRecord(row) : null;
  }

  async update(
    journeyId: string,
    patch: UpdateJourneyInput,
  ): Promise<JourneyRecord | null> {
    const set: Record<string, unknown> = { updatedAt: sql`now()` };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.destinationAddress !== undefined)
      set.destinationAddress = patch.destinationAddress;
    if (patch.lagThresholdMeters !== undefined)
      set.lagThresholdMeters = patch.lagThresholdMeters;
    if (patch.destination !== undefined)
      set.destination = geogPoint(
        patch.destination.latitude,
        patch.destination.longitude,
      );

    const [row] = await this.db
      .update(journeys)
      .set(set)
      .where(eq(journeys.id, journeyId))
      .returning(this.selection());
    return row ? this.toRecord(row) : null;
  }

  // Drives start / end / delete / auto-complete status transitions, optionally
  // stamping start_time or end_time (replaces FieldValue.serverTimestamp()).
  async updateStatus(
    journeyId: string,
    status: JourneyStatus,
    opts: { setStartTime?: boolean; setEndTime?: boolean } = {},
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<JourneyRecord | null> {
    const set: Record<string, unknown> = { status, updatedAt: sql`now()` };
    if (opts.setStartTime) set.startTime = sql`now()`;
    if (opts.setEndTime) set.endTime = sql`now()`;

    const [row] = await (tx ?? this.db)
      .update(journeys)
      .set(set)
      .where(eq(journeys.id, journeyId))
      .returning(this.selection());
    return row ? this.toRecord(row) : null;
  }
}
