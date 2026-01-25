import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { LocationService } from './location.service';
import { LocationUpdateDto } from './dto/location-update.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('locations')
@UseGuards(FirebaseAuthGuard)
export class LocationController {
  constructor(private locationService: LocationService) {}

  /**
   * REST fallback endpoint for location updates
   * Use this when WebSocket is not available
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createLocationUpdate(
    @CurrentUser('uid') userId: string,
    @Body() locationUpdateDto: LocationUpdateDto,
  ) {
    const result = await this.locationService.processLocationUpdate(
      userId,
      locationUpdateDto,
    );

    return {
      success: result.success,
      sequenceNumber: result.sequenceNumber,
      priority: result.priority,
      message: result.success
        ? 'Location update processed successfully'
        : 'Location update throttled',
    };
  }

  /**
   * Get location history for a journey
   */
  @Get('journeys/:journeyId/history')
  async getLocationHistory(
    @Param('journeyId') journeyId: string,
    @CurrentUser('uid') userId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.locationService.getLocationHistory(
      journeyId,
      userId,
      limit || 100,
    );
  }

  /**
   * Get latest locations for all participants in a journey
   */
  @Get('journeys/:journeyId/latest')
  async getLatestLocations(
    @Param('journeyId') journeyId: string,
    @CurrentUser('uid') userId: string,
  ) {
    return this.locationService.getLatestLocations(journeyId, userId);
  }

  /**
   * Get location history for a specific participant
   */
  @Get('journeys/:journeyId/participants/:participantId/history')
  async getParticipantLocationHistory(
    @Param('journeyId') journeyId: string,
    @Param('participantId') participantId: string,
    @CurrentUser('uid') userId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.locationService.getParticipantLocationHistory(
      journeyId,
      participantId,
      userId,
      limit || 50,
    );
  }
}
