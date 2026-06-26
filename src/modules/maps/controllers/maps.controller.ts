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
import { SearchPlacesDto, GetRouteDto } from '../dto';
import {
  SearchPlacesResponse,
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
