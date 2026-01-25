import { GeoPoint } from 'firebase-admin/firestore';

export class DistanceUtils {
  /**
   * Calculate distance between two points using Haversine formula
   * @param point1 First coordinate point
   * @param point2 Second coordinate point
   * @returns Distance in meters
   */
  static haversineDistance(
    point1: { latitude: number; longitude: number } | GeoPoint,
    point2: { latitude: number; longitude: number } | GeoPoint,
  ): number {
    const lat1 =
      'latitude' in point1 ? point1.latitude : (point1 as GeoPoint).latitude;
    const lon1 =
      'longitude' in point1 ? point1.longitude : (point1 as GeoPoint).longitude;
    const lat2 =
      'latitude' in point2 ? point2.latitude : (point2 as GeoPoint).latitude;
    const lon2 =
      'longitude' in point2 ? point2.longitude : (point2 as GeoPoint).longitude;

    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Check if a coordinate is valid
   */
  static isValidCoordinate(latitude: number, longitude: number): boolean {
    return (
      latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    );
  }

  /**
   * Convert GeoPoint to simple coordinates object
   */
  static geoPointToCoords(geoPoint: GeoPoint): {
    latitude: number;
    longitude: number;
  } {
    return {
      latitude: geoPoint.latitude,
      longitude: geoPoint.longitude,
    };
  }
}
