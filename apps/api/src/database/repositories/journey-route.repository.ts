import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { geogPoint, selectLat, selectLng } from '../../common/utils/geo.utils';
import { DatabaseService } from '../database.service';
import { JourneyRouteStep, journeyRoutes, journeys } from '../schema';
import { LatLng } from '../schema/columns/geography-point';

export type JourneyRouteReason = 'INITIAL' | 'LEADER_REROUTE' | 'MANUAL';

export interface JourneyRouteRecord {
  id: string;
  journeyId: string;
  version: number;
  coordinates: number[][];
  distanceMetres: number;
  durationSeconds: number;
  steps: JourneyRouteStep[];
  origin: LatLng;
  destination: LatLng;
  reason: JourneyRouteReason;
  createdBy: string;
  requestId: string;
  isCurrent: boolean;
  createdAt: Date;
}

export interface ReplaceJourneyRouteInput {
  journeyId: string;
  baseVersion: number;
  coordinates: number[][];
  distanceMetres: number;
  durationSeconds: number;
  steps: JourneyRouteStep[];
  origin: LatLng;
  destination: LatLng;
  reason: JourneyRouteReason;
  createdBy: string;
  requestId: string;
}

export class JourneyRouteVersionConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super(`Route version conflict; current version is ${currentVersion}`);
    this.name = 'JourneyRouteVersionConflictError';
  }
}

export class JourneyRouteInactiveError extends Error {
  constructor() {
    super('Canonical routes can only be updated for active journeys');
    this.name = 'JourneyRouteInactiveError';
  }
}

type SelectedRoute = {
  id: string;
  journeyId: string;
  version: number;
  geometry: number[][];
  distanceMetres: number;
  durationSeconds: number;
  steps: JourneyRouteStep[];
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  reason: JourneyRouteReason;
  createdBy: string;
  requestId: string;
  isCurrent: boolean;
  createdAt: Date;
};

@Injectable()
export class JourneyRouteRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  private selection() {
    return {
      id: journeyRoutes.id,
      journeyId: journeyRoutes.journeyId,
      version: journeyRoutes.version,
      geometry: journeyRoutes.geometry,
      distanceMetres: journeyRoutes.distanceMetres,
      durationSeconds: journeyRoutes.durationSeconds,
      steps: journeyRoutes.steps,
      originLat: selectLat(journeyRoutes.origin),
      originLng: selectLng(journeyRoutes.origin),
      destinationLat: selectLat(journeyRoutes.destination),
      destinationLng: selectLng(journeyRoutes.destination),
      reason: journeyRoutes.reason,
      createdBy: journeyRoutes.createdBy,
      requestId: journeyRoutes.requestId,
      isCurrent: journeyRoutes.isCurrent,
      createdAt: journeyRoutes.createdAt,
    };
  }

  private toRecord(row: SelectedRoute): JourneyRouteRecord {
    const {
      geometry,
      originLat,
      originLng,
      destinationLat,
      destinationLng,
      ...rest
    } = row;
    return {
      ...rest,
      coordinates: geometry,
      origin: { latitude: originLat, longitude: originLng },
      destination: {
        latitude: destinationLat,
        longitude: destinationLng,
      },
    };
  }

  async findCurrent(journeyId: string): Promise<JourneyRouteRecord | null> {
    const [row] = await this.db
      .select(this.selection())
      .from(journeyRoutes)
      .where(
        and(
          eq(journeyRoutes.journeyId, journeyId),
          eq(journeyRoutes.isCurrent, true),
        ),
      )
      .limit(1);
    return row ? this.toRecord(row) : null;
  }

  async findByRequestId(
    journeyId: string,
    requestId: string,
  ): Promise<JourneyRouteRecord | null> {
    const [row] = await this.db
      .select(this.selection())
      .from(journeyRoutes)
      .where(
        and(
          eq(journeyRoutes.journeyId, journeyId),
          eq(journeyRoutes.requestId, requestId),
        ),
      )
      .limit(1);
    return row ? this.toRecord(row) : null;
  }

  /**
   * Replaces the canonical route while holding a lock on the parent journey.
   * Locking the parent serializes the first route too, where no route row yet
   * exists to lock, and makes baseVersion an actual compare-and-swap guard.
   */
  async replaceCurrent(
    input: ReplaceJourneyRouteInput,
  ): Promise<JourneyRouteRecord> {
    return this.db.transaction(async (tx) => {
      const [lockedJourney] = await tx
        .select({ id: journeys.id, status: journeys.status })
        .from(journeys)
        .where(eq(journeys.id, input.journeyId))
        .for('update');

      // Mapbox calculation happens before this transaction. Revalidate while
      // holding the journey lock so a route cannot be committed after end().
      if (!lockedJourney || lockedJourney.status !== 'ACTIVE') {
        throw new JourneyRouteInactiveError();
      }

      const [duplicate] = await tx
        .select(this.selection())
        .from(journeyRoutes)
        .where(
          and(
            eq(journeyRoutes.journeyId, input.journeyId),
            eq(journeyRoutes.requestId, input.requestId),
          ),
        )
        .limit(1);
      if (duplicate) return this.toRecord(duplicate);

      const [current] = await tx
        .select({ version: journeyRoutes.version })
        .from(journeyRoutes)
        .where(
          and(
            eq(journeyRoutes.journeyId, input.journeyId),
            eq(journeyRoutes.isCurrent, true),
          ),
        )
        .limit(1);
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== input.baseVersion) {
        throw new JourneyRouteVersionConflictError(currentVersion);
      }

      if (current) {
        await tx
          .update(journeyRoutes)
          .set({ isCurrent: false })
          .where(
            and(
              eq(journeyRoutes.journeyId, input.journeyId),
              eq(journeyRoutes.isCurrent, true),
            ),
          );
      }

      const [inserted] = await tx
        .insert(journeyRoutes)
        .values({
          journeyId: input.journeyId,
          version: currentVersion + 1,
          geometry: input.coordinates,
          distanceMetres: input.distanceMetres,
          durationSeconds: input.durationSeconds,
          steps: input.steps,
          origin: geogPoint(input.origin.latitude, input.origin.longitude),
          destination: geogPoint(
            input.destination.latitude,
            input.destination.longitude,
          ),
          reason: input.reason,
          createdBy: input.createdBy,
          requestId: input.requestId,
          isCurrent: true,
        })
        .returning(this.selection());

      return this.toRecord(inserted);
    });
  }
}
