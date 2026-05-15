import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('analytics')
@UseGuards(FirebaseAuthGuard)
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  /**
   * Get analytics for a specific journey
   */
  @Get('journeys/:id')
  async getJourneyAnalytics(@Param('id') id: string) {
    return this.analyticsService.getJourneyAnalytics(id);
  }

  /**
   * Get journey summary for the post-trip screen.
   * Returns pre-calculated analytics if available, otherwise triggers
   * calculation on demand.
   */
  @Get('journeys/:id/summary')
  async getJourneySummary(@Param('id') id: string) {
    // Try pre-calculated analytics first
    let analytics = await this.analyticsService.getJourneyAnalytics(id);

    // If not yet calculated (e.g. older journeys), calculate now
    if (!analytics) {
      try {
        analytics = await this.analyticsService.calculateJourneyAnalytics(id);
      } catch {
        // Journey may not have location data — return null gracefully
        return null;
      }
    }

    return analytics;
  }

  /**
   * Get user's journey history with analytics
   */
  @Get('user')
  async getUserJourneyHistory(
    @CurrentUser('uid') userId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.analyticsService.getUserJourneyHistory(userId, limit || 20);
  }
}
