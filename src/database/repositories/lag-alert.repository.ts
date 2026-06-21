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

  // Idempotent lag alert: refresh the participant's existing open alert if one
  // is already active, otherwise create a fresh row. Prevents an alert row from
  // accumulating on every follower update while they remain lagging.
  async upsertActiveForParticipant(
    input: CreateLagAlertInput,
  ): Promise<LagAlertRecord> {
    const [existing] = await this.db
      .select({ id: lagAlerts.id })
      .from(lagAlerts)
      .where(
        and(
          eq(lagAlerts.journeyId, input.journeyId),
          eq(lagAlerts.participantId, input.participantId),
          eq(lagAlerts.isActive, true),
        ),
      )
      .limit(1);

    if (existing) {
      const [row] = await this.db
        .update(lagAlerts)
        .set({
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
        })
        .where(eq(lagAlerts.id, existing.id))
        .returning(this.selection());
      return toRecord(row);
    }

    return this.create(input);
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

  // All alerts for a journey (active or not) — used for analytics.
  async getByJourney(journeyId: string): Promise<LagAlertRecord[]> {
    const rows = await this.db
      .select(this.selection())
      .from(lagAlerts)
      .where(eq(lagAlerts.journeyId, journeyId));
    return rows.map(toRecord);
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
