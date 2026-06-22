import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  ValidationPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FirebaseAuthGuard } from '../../../common/guards/firebase-auth.guard';
import { MapsService } from '../services/maps.service';
import { SearchPlacesDto, ReverseGeocodeDto, GetRouteDto } from '../dto';
import {
  SearchPlacesResponse,
  ReverseGeocodeResult,
  RouteResult,
} from '../interfaces/place-result.interface';

@ApiTags('Maps')
@Controller('maps')
@UseGuards(FirebaseAuthGuard)
@ApiBearerAuth()
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search for places using Google Places API' })
  @ApiResponse({
    status: 200,
    description: 'Places found successfully',
    type: SearchPlacesResponse,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid JWT token' })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid query parameters',
  })
  async searchPlaces(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    searchDto: SearchPlacesDto,
  ): Promise<SearchPlacesResponse> {
    const results = await this.mapsService.searchPlaces(
      searchDto.query,
      searchDto.lat,
      searchDto.lng,
      searchDto.regionCode,
    );
    return { results };
  }

  @Get('reverse')
  @ApiOperation({ summary: 'Reverse geocode coordinates to address' })
  @ApiResponse({
    status: 200,
    description: 'Address found successfully',
    type: ReverseGeocodeResult,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid JWT token' })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid coordinates',
  })
  async reverseGeocode(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    reverseDto: ReverseGeocodeDto,
  ): Promise<ReverseGeocodeResult> {
    return await this.mapsService.reverseGeocode(
      reverseDto.lat,
      reverseDto.lng,
    );
  }

  @Post('route')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get road-following route from Mapbox Directions API',
    description:
      'Returns GeoJSON coordinates, distance, duration and step-by-step ' +
      'instructions for a driving route. Results cached 5 min in Redis.',
  })
  @ApiResponse({ status: 200, description: 'Route calculated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Invalid coordinates' })
  async getRoute(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    routeDto: GetRouteDto,
  ): Promise<RouteResult | null> {
    return this.mapsService.getRoute(
      routeDto.originLat,
      routeDto.originLng,
      routeDto.destLat,
      routeDto.destLng,
    );
  }
}
