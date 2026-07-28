import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../database.service';
import { JourneyAnalyticsStats, journeyAnalytics } from '../schema';

export type AnalyticsRecord = typeof journeyAnalytics.$inferSelect;

export interface UpsertAnalyticsInput {
  journeyId: string;
  startTime?: Date | null;
  endTime?: Date | null;
  totalDuration?: number | null;
  totalDistance?: number | null;
  averageSpeed?: number | null;
  maxLagDistance?: number | null;
  lagAlertCount: number;
  participantCount: number;
  routePolyline?: string | null;
  stats: JourneyAnalyticsStats;
}

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  // 1:1 with journey — recompute on journey end overwrites the prior row.
  async upsert(input: UpsertAnalyticsInput): Promise<AnalyticsRecord> {
    const values = {
      journeyId: input.journeyId,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      totalDuration: input.totalDuration ?? null,
      totalDistance: input.totalDistance ?? null,
      averageSpeed: input.averageSpeed ?? null,
      maxLagDistance: input.maxLagDistance ?? null,
      lagAlertCount: input.lagAlertCount,
      participantCount: input.participantCount,
      routePolyline: input.routePolyline ?? null,
      stats: input.stats,
    };

    const [row] = await this.db
      .insert(journeyAnalytics)
      .values(values)
      .onConflictDoUpdate({
        target: journeyAnalytics.journeyId,
        set: {
          startTime: values.startTime,
          endTime: values.endTime,
          totalDuration: values.totalDuration,
          totalDistance: values.totalDistance,
          averageSpeed: values.averageSpeed,
          maxLagDistance: values.maxLagDistance,
          lagAlertCount: values.lagAlertCount,
          participantCount: values.participantCount,
          routePolyline: values.routePolyline,
          stats: values.stats,
        },
      })
      .returning();
    return row;
  }

  async findByJourneyId(journeyId: string): Promise<AnalyticsRecord | null> {
    const [row] = await this.db
      .select()
      .from(journeyAnalytics)
      .where(eq(journeyAnalytics.journeyId, journeyId))
      .limit(1);
    return row ?? null;
  }

  // Batch fetch for the journey-history list (avoids a per-journey round-trip).
  async findByJourneyIds(journeyIds: string[]): Promise<AnalyticsRecord[]> {
    if (journeyIds.length === 0) return [];
    return this.db
      .select()
      .from(journeyAnalytics)
      .where(inArray(journeyAnalytics.journeyId, journeyIds));
  }
}
