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

export class ReverseGeocodeResult {
  @ApiProperty({
    description: 'Short name or primary identifier of the location',
  })
  displayName: string;

  @ApiProperty({ description: 'Full formatted address' })
  address: string;

  @ApiProperty({ description: 'Latitude coordinate' })
  lat: number;

  @ApiProperty({ description: 'Longitude coordinate' })
  lng: number;
}
