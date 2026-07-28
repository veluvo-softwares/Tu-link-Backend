import { sql, SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * The one place lat/lng ↔ PostGIS axis order is handled.
 *
 * Firestore uses GeoPoint(latitude, longitude); PostGIS uses
 * POINT(longitude, latitude). Repositories (Phase 2) MUST use these helpers
 * for ALL geography reads/writes so the axis flip is never hand-written again.
 */

/** WRITE helper — build a `geography(Point,4326)` from lat/lng (axis flip lives here). */
export const geogPoint = (latitude: number, longitude: number): SQL =>
  sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`;

/** READ helper — select latitude out of a geography column. */
export const selectLat = (col: PgColumn | SQL): SQL<number> =>
  sql<number>`ST_Y(${col}::geometry)`;

/** READ helper — select longitude out of a geography column. */
export const selectLng = (col: PgColumn | SQL): SQL<number> =>
  sql<number>`ST_X(${col}::geometry)`;
