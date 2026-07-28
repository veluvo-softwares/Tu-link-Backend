import { ApiProperty } from '@nestjs/swagger';

export class PlaceResult {
  @ApiProperty({ description: 'Unique place identifier from Google Places' })
  placeId: string;

  @ApiProperty({ description: 'Human-readable name of the place' })
  displayName: string;

  @ApiProperty({ description: 'Formatted address of the place' })
  address: string;

  @ApiProperty({ description: 'Latitude coordinate' })
  lat: number;

  @ApiProperty({ description: 'Longitude coordinate' })
  lng: number;

  @ApiProperty({ description: 'Array of place types', type: [String] })
  types: string[];
}

export class SearchPlacesResponse {
  @ApiProperty({ description: 'Array of search results', type: [PlaceResult] })
  results: PlaceResult[];
}

export class RouteStep {
  instruction: string;
  distanceMetres: number;
  maneuver: string;
}

export class RouteResult {
  /** GeoJSON coordinates [[lng, lat], ...] ready for Mapbox LineString */
  coordinates: number[][];
  distanceMetres: number;
  durationSeconds: number;
  steps: RouteStep[];
}
