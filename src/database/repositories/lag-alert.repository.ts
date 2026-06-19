import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { geogPoint, selectLat, selectLng } from '../../common/utils/geo.utils';
import { LagSeverity } from '../../types/notification.type';
import { LatLng } from '../schema/columns/geography-point';
import { DatabaseService } from '../database.service';
import { lagAlerts } from '../schema';

export interface LagAlertRecord {
  id: string;
  journeyId: string;
  participantId: string;
  distanceFromLeader: number;
  leaderLocation: LatLng;
  followerLocation: LatLng;
  severity: LagSeverity;
  isActive: boolean;
  createdAt: Date;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
}

export interface CreateLagAlertInput {
  journeyId: string;
  participantId: string;
  distanceFromLeader: number;
  leaderLocation: LatLng;
  followerLocation: LatLng;
  severity: LagSeverity;
}

type SelectedRow = {
  id: string;
  journeyId: string;
  participantId: string;
  distanceFromLeader: number;
  leaderLat: number;
  leaderLng: number;
  followerLat: number;
  followerLng: number;
  severity: LagSeverity;
  isActive: boolean;
  createdAt: Date;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
};

const toRecord = (row: SelectedRow): LagAlertRecord => {
  const { leaderLat, leaderLng, followerLat, followerLng, ...rest } = row;
  return {
    ...rest,
    leaderLocation: { latitude: leaderLat, longitude: leaderLng },
    followerLocation: { latitude: followerLat, longitude: followerLng },
  };
};

@Injectable()
export class LagAlertRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  private selection() {
    return {
      id: lagAlerts.id,
      journeyId: lagAlerts.journeyId,
      participantId: lagAlerts.participantId,
      distanceFromLeader: lagAlerts.distanceFromLeader,
      leaderLat: selectLat(lagAlerts.leaderLocation),
      leaderLng: selectLng(lagAlerts.leaderLocation),
      followerLat: selectLat(lagAlerts.followerLocation),
      followerLng: selectLng(lagAlerts.followerLocation),
      severity: lagAlerts.severity,
      isActive: lagAlerts.isActive,
      createdAt: lagAlerts.createdAt,
      resolvedAt: lagAlerts.resolvedAt,
      acknowledgedAt: lagAlerts.acknowledgedAt,
    };
  }

  async create(input: CreateLagAlertInput): Promise<LagAlertRecord> {
    const [row] = await this.db
      .insert(lagAlerts)
      .values({
        journeyId: input.journeyId,
        participantId: input.participantId,
        distanceFromLeader: input.distanceFromLeader,
        leaderLocation: geogPoint(
          input.leaderLocation.latitude,
          input.leaderLocation.longitude,
        ),
        followerLocation: geogPoint(
          input.followerLocation.latitude,
          input.followerLocation.longitude,
        ),
        severity: input.severity,
        isActive: true,
      })
      .returning(this.selection());
    return toRecord(row);
  }

  // Participant caught up → close their open alerts.
  async resolveActiveForParticipant(
    journeyId: string,
    participantId: string,
  ): Promise<void> {
    await this.db
      .update(lagAlerts)
      .set({ isActive: false, resolvedAt: sql`now()` })
      .where(
        and(
          eq(lagAlerts.journeyId, journeyId),
          eq(lagAlerts.participantId, participantId),
          eq(lagAlerts.isActive, true),
        ),
      );
  }

  async getActive(journeyId: string): Promise<LagAlertRecord[]> {
    const rows = await this.db
      .select(this.selection())
      .from(lagAlerts)
      .where(
        and(eq(lagAlerts.journeyId, journeyId), eq(lagAlerts.isActive, true)),
      );
    return rows.map(toRecord);
  }

  async acknowledge(alertId: string, journeyId: string): Promise<void> {
    await this.db
      .update(lagAlerts)
      .set({ acknowledgedAt: sql`now()` })
      .where(
        and(eq(lagAlerts.id, alertId), eq(lagAlerts.journeyId, journeyId)),
      );
  }
}
