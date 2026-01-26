import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, LatLng } from '@googlemaps/google-maps-services-js';
import { DistanceUtils } from '../../../common/utils/distance.utils';

interface RouteInfo {
  polyline: string;
  distance: number;
  duration: number;
}

@Injectable()
export class MapsService {
  private client: Client;

  constructor(private configService: ConfigService) {
    this.client = new Client({});
  }

  /**
   * Geocode an address to coordinates
   */
  async geocodeAddress(address: string): Promise<LatLng | null> {
    try {
      const response = await this.client.geocode({
        params: {
          address,
          key: this.configService.get('maps.apiKey') || '',
        },
      });

      if (response.data.results.length > 0) {
        return response.data.results[0].geometry.location;
      }

      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  }

  /**
   * Reverse geocode coordinates to address
   */
  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      const response = await this.client.reverseGeocode({
        params: {
          latlng: { lat, lng },
          key: this.configService.get('maps.apiKey') || '',
        },
      });

      if (response.data.results.length > 0) {
        return response.data.results[0].formatted_address;
      }

      return null;
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      return null;
    }
  }

  /**
   * Calculate distance between two points using Haversine formula
   * (local calculation, no API call)
   */
  calculateDistance(
    from: { latitude: number; longitude: number },
    to: { latitude: number; longitude: number },
  ): number {
    return DistanceUtils.haversineDistance(from, to);
  }

  /**
   * Calculate distance using Google Distance Matrix API
   * (more accurate as it considers actual roads)
   */
  async calculateRouteDistance(
    from: { latitude: number; longitude: number },
    to: { latitude: number; longitude: number },
  ): Promise<{ distance: number; duration: number } | null> {
    try {
      const response = await this.client.distancematrix({
        params: {
          origins: [`${from.latitude},${from.longitude}`],
          destinations: [`${to.latitude},${to.longitude}`],
          key: this.configService.get('maps.apiKey') || '',
        },
      });

      const element = response.data.rows[0]?.elements[0];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (element && element.status === 'OK') {
        return {
          distance: element.distance.value, // meters
          duration: element.duration.value, // seconds
        };
      }

      return null;
    } catch (error) {
      console.error('Distance Matrix error:', error);
      return null;
    }
  }

  /**
   * Get route directions between two points
   */
  async getDirections(
    from: { latitude: number; longitude: number },
    to: { latitude: number; longitude: number },
  ): Promise<RouteInfo | null> {
    try {
      const response = await this.client.directions({
        params: {
          origin: `${from.latitude},${from.longitude}`,
          destination: `${to.latitude},${to.longitude}`,
          key: this.configService.get('maps.apiKey') || '',
        },
      });

      if (response.data.routes.length > 0) {
        const route = response.data.routes[0];
        return {
          polyline: route.overview_polyline.points,
          distance: route.legs[0].distance.value,
          duration: route.legs[0].duration.value,
        };
      }

      return null;
    } catch (error) {
      console.error('Directions error:', error);
      return null;
    }
  }

  /**
   * Calculate ETA (Estimated Time of Arrival)
   */
  async calculateETA(
    from: { latitude: number; longitude: number },
    to: { latitude: number; longitude: number },
  ): Promise<number | null> {
    const result = await this.calculateRouteDistance(from, to);
    return result ? result.duration : null;
  }
}
