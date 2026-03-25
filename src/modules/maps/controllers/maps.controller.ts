import {
  Controller,
  Get,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FirebaseAuthGuard } from '../../../common/guards/firebase-auth.guard';
import { MapsService } from '../services/maps.service';
import { SearchPlacesDto, ReverseGeocodeDto } from '../dto';
import {
  SearchPlacesResponse,
  ReverseGeocodeResult,
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
}
