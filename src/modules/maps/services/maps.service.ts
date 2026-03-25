import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  LatLng,
  AddressType,
} from '@googlemaps/google-maps-services-js';
import { RedisService } from '../../../shared/redis/redis.service';
import { DistanceUtils } from '../../../common/utils/distance.utils';
import {
  PlaceResult,
  ReverseGeocodeResult,
} from '../interfaces/place-result.interface';

interface RouteInfo {
  polyline: string;
  distance: number;
  duration: number;
}

// Google Places API (New) response types - internal use only
interface GoogleNewPlacesResponse {
  places?: Array<{
    id: string;
    displayName: { text: string; languageCode: string };
    formattedAddress: string;
    location: { latitude: number; longitude: number };
    types?: string[];
  }>;
}

// Note: GoogleGeocodeResponse interface removed as it's not needed with @googlemaps/google-maps-services-js client

@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);
  private client: Client;
  private apiKey: string;

  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
  ) {
    this.client = new Client({});
    this.apiKey = this.configService.getOrThrow<string>('maps.apiKey');
  }

  /**
   * Search for places using Google Places API (New)
   * @param query Search query text
   * @param lat Optional latitude for location bias
   * @param lng Optional longitude for location bias
   */
  async searchPlaces(
    query: string,
    lat?: number,
    lng?: number,
  ): Promise<PlaceResult[]> {
    // Build cache key with 2dp precision for search (Watchout 3)
    const normalizedQuery = query.toLowerCase().trim().replace(/\s+/g, '_');
    const latStr = lat !== undefined ? lat.toFixed(2) : '';
    const lngStr = lng !== undefined ? lng.toFixed(2) : '';
    const locationSuffix =
      lat !== undefined && lng !== undefined ? `:${latStr}:${lngStr}` : '';
    const cacheKey = `maps:search:${normalizedQuery}${locationSuffix}`;

    // Check Redis cache first
    const redisClient = this.redisService.getClient();
    const cachedResult = await redisClient.get(cacheKey);

    if (cachedResult) {
      this.logger.debug(`[Maps] Cache hit: ${cacheKey}`);
      return JSON.parse(cachedResult) as PlaceResult[];
    }

    this.logger.debug(`[Maps] Cache miss — calling Google: ${cacheKey}`);

    // Prepare request body for Google Places API (New)
    interface GooglePlacesRequest {
      textQuery: string;
      pageSize: number;
      languageCode: string;
      locationBias?: {
        circle: {
          center: { latitude: number; longitude: number };
          radius: number;
        };
      };
    }

    const requestBody: GooglePlacesRequest = {
      textQuery: query,
      pageSize: 5,
      languageCode: 'en',
    };

    // Add location bias if coordinates provided
    if (lat !== undefined && lng !== undefined) {
      requestBody.locationBias = {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 50000.0, // 50km radius
        },
      };
    }

    try {
      // Call Google Places API (New) - POST request (Watchout 4)
      const response = await fetch(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask':
              'places.id,places.displayName,places.formattedAddress,places.location,places.types',
          },
          body: JSON.stringify(requestBody),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Google Places API error: ${response.status} - ${errorBody}`,
        );
        throw new Error(`Google Places API returned ${response.status}`);
      }

      const data = (await response.json()) as GoogleNewPlacesResponse;

      // Normalize to PlaceResult[] (Watchout 5 - different field names)
      const results: PlaceResult[] = (data.places ?? []).map((place) => ({
        placeId: place.id,
        displayName: place.displayName.text,
        address: place.formattedAddress,
        lat: place.location.latitude,
        lng: place.location.longitude,
        types: place.types ?? [],
      }));

      // Cache result with 7 day TTL
      const ttlSeconds = 60 * 60 * 24 * 7; // 7 days
      await redisClient.setex(cacheKey, ttlSeconds, JSON.stringify(results));

      return results;
    } catch (error) {
      this.logger.error('Error searching places:', error);
      throw new Error('Failed to search places');
    }
  }

  /**
   * Geocode an address to coordinates
   */
  async geocodeAddress(address: string): Promise<LatLng | null> {
    try {
      const response = await this.client.geocode({
        params: {
          address,
          key: this.apiKey,
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
  async reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<ReverseGeocodeResult> {
    // Build cache key with 4dp precision for reverse geocoding (Watchout 3)
    const cacheKey = `maps:reverse:${lat.toFixed(4)}:${lng.toFixed(4)}`;

    // Check Redis cache first
    const redisClient = this.redisService.getClient();
    const cachedResult = await redisClient.get(cacheKey);

    if (cachedResult) {
      this.logger.debug(`[Maps] Cache hit: ${cacheKey}`);
      return JSON.parse(cachedResult) as ReverseGeocodeResult;
    }

    this.logger.debug(`[Maps] Cache miss — calling Google: ${cacheKey}`);

    try {
      const response = await this.client.reverseGeocode({
        params: {
          latlng: { lat, lng },
          key: this.apiKey,
          result_type: [
            AddressType.establishment,
            AddressType.point_of_interest,
            AddressType.route,
            AddressType.locality,
          ],
        },
      });

      let result: ReverseGeocodeResult;

      if (response.data.results.length > 0) {
        const firstResult = response.data.results[0];
        const displayName =
          firstResult.address_components[0]?.long_name || 'Unknown location';

        result = {
          displayName,
          address: firstResult.formatted_address,
          lat,
          lng,
        };
      } else {
        result = {
          displayName: 'Unknown location',
          address: '',
          lat,
          lng,
        };
      }

      // Cache result with 1 day TTL
      const ttlSeconds = 60 * 60 * 24; // 1 day
      await redisClient.setex(cacheKey, ttlSeconds, JSON.stringify(result));

      return result;
    } catch (error) {
      this.logger.error('Reverse geocoding error:', error);

      // Return fallback result on error
      return {
        displayName: 'Unknown location',
        address: '',
        lat,
        lng,
      };
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
          key: this.apiKey,
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
          key: this.apiKey,
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
