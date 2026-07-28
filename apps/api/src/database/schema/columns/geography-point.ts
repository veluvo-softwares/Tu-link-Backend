import { customType } from 'drizzle-orm/pg-core';

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * PostGIS `geography(Point,4326)` column.
 *
 * The DDL emits `geography(Point,4326)`. Writes send EWKT, which PostGIS
 * implicitly casts from text. LONGITUDE FIRST (migration invariant B:
 * Firestore is (lat, lng); PostGIS POINT is (lng, lat)).
 *
 * Reads must NOT select the raw column — use the geo.utils helpers
 * (ST_X / ST_Y) instead, so there is no fromDriver / EWKB parsing to do here.
 */
export const geographyPoint = customType<{ data: LatLng; driverData: string }>({
  dataType() {
    return 'geography(Point,4326)';
  },
  toDriver(v: LatLng): string {
    return `SRID=4326;POINT(${v.longitude} ${v.latitude})`;
  },
});
