import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../shared/redis/redis.service';
import { FirebaseService } from '../../../shared/firebase/firebase.service';
import { LoggerService } from '../../../shared/logger/logger.service';

export type LocationStrategy = 'REALTIME' | 'BATCHED' | 'POLLING';

export interface JourneyMetrics {
  activeParticipantCount: number;
  strategy: LocationStrategy;
  lastUpdated: number;
  performanceMetrics?: {
    avgLatency: number;
    messageCount: number;
    errorRate: number;
  };
}

@Injectable()
export class JourneyMetricsService {
  constructor(
    private readonly redisService: RedisService,
    private readonly firebaseService: FirebaseService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Get the current active participant count for a journey
   */
  async getActiveParticipantCount(journeyId: string): Promise<number> {
    try {
      // Get connected sockets for this journey from Redis
      const connectedSockets =
        await this.redisService.getRoomSockets(journeyId);

      // Count unique user IDs (in case of multiple connections per user)
      const uniqueUsers = new Set<string>();

      for (const socketId of connectedSockets) {
        const userId = await this.redisService.getSocketUser(socketId);
        if (userId) {
          uniqueUsers.add(userId);
        }
      }

      return uniqueUsers.size;
    } catch (error) {
      this.logger.error(
        `Failed to get active participant count for journey ${journeyId}: ${(error as Error).message}`,
        'JourneyMetricsService',
      );
      return 0;
    }
  }

  /**
   * Determine the optimal location strategy based on journey size and metrics
   */
  async getJourneyStrategy(journeyId: string): Promise<LocationStrategy> {
    try {
      const participantCount = await this.getActiveParticipantCount(journeyId);

      // Get configuration thresholds
      const smallJourneyThreshold =
        this.configService.get<number>('app.websocket.smallJourneyThreshold') ||
        5;
      const mediumJourneyThreshold =
        this.configService.get<number>(
          'app.websocket.mediumJourneyThreshold',
        ) || 20;

      // Apply strategy selection logic
      const strategy = this.selectLocationStrategy(
        participantCount,
        smallJourneyThreshold,
        mediumJourneyThreshold,
      );

      // Cache strategy decision in Redis for quick access
      await this.cacheJourneyMetrics(journeyId, {
        activeParticipantCount: participantCount,
        strategy,
        lastUpdated: Date.now(),
      });

      this.logger.info(
        `Journey ${journeyId}: ${participantCount} participants, strategy: ${strategy}`,
        'JourneyMetricsService',
      );

      return strategy;
    } catch (error) {
      this.logger.error(
        `Failed to get journey strategy for ${journeyId}: ${(error as Error).message}`,
        'JourneyMetricsService',
      );
      // Default to real-time for small groups on error
      return 'REALTIME';
    }
  }

  /**
   * Update performance metrics for a journey strategy
   */
  async updateStrategyMetrics(
    journeyId: string,
    strategy: LocationStrategy,
    latency: number,
  ): Promise<void> {
    try {
      const metricsKey = `journey_metrics:${journeyId}`;

      // Get existing metrics
      const cachedData = await this.redisService.getClient().get(metricsKey);
      const cachedMetrics = cachedData
        ? (JSON.parse(cachedData) as JourneyMetrics)
        : null;

      if (cachedMetrics) {
        // Update performance metrics
        const currentMetrics = cachedMetrics.performanceMetrics || {
          avgLatency: latency,
          messageCount: 1,
          errorRate: 0,
        };

        // Calculate rolling average latency
        const totalMessages = currentMetrics.messageCount + 1;
        const newAvgLatency =
          (currentMetrics.avgLatency * currentMetrics.messageCount + latency) /
          totalMessages;

        cachedMetrics.performanceMetrics = {
          avgLatency: newAvgLatency,
          messageCount: totalMessages,
          errorRate: currentMetrics.errorRate,
        };

        cachedMetrics.lastUpdated = Date.now();

        // Cache updated metrics
        await this.redisService
          .getClient()
          .setex(metricsKey, 300, JSON.stringify(cachedMetrics)); // 5-minute TTL
      }
    } catch (error) {
      this.logger.error(
        `Failed to update strategy metrics for journey ${journeyId}: ${(error as Error).message}`,
        'JourneyMetricsService',
      );
    }
  }

  /**
   * Get cached journey metrics
   */
  async getJourneyMetrics(journeyId: string): Promise<JourneyMetrics | null> {
    try {
      const metricsKey = `journey_metrics:${journeyId}`;
      const cachedData = await this.redisService.getClient().get(metricsKey);
      return cachedData ? (JSON.parse(cachedData) as JourneyMetrics) : null;
    } catch (error) {
      this.logger.error(
        `Failed to get journey metrics for ${journeyId}: ${(error as Error).message}`,
        'JourneyMetricsService',
      );
      return null;
    }
  }

  /**
   * Strategy selection logic based on participant count
   */
  private selectLocationStrategy(
    participantCount: number,
    smallThreshold: number,
    mediumThreshold: number,
  ): LocationStrategy {
    if (participantCount <= smallThreshold) {
      return 'REALTIME';
    } else if (participantCount <= mediumThreshold) {
      return 'BATCHED';
    } else {
      return 'POLLING';
    }
  }

  /**
   * Cache journey metrics in Redis
   */
  private async cacheJourneyMetrics(
    journeyId: string,
    metrics: JourneyMetrics,
  ): Promise<void> {
    try {
      const metricsKey = `journey_metrics:${journeyId}`;
      await this.redisService
        .getClient()
        .setex(metricsKey, 300, JSON.stringify(metrics)); // 5-minute TTL
    } catch (error) {
      this.logger.error(
        `Failed to cache journey metrics for ${journeyId}: ${(error as Error).message}`,
        'JourneyMetricsService',
      );
    }
  }

  /**
   * Clear journey metrics when journey ends
   */
  async clearJourneyMetrics(journeyId: string): Promise<void> {
    try {
      const metricsKey = `journey_metrics:${journeyId}`;
      await this.redisService.getClient().del(metricsKey);
    } catch (error) {
      this.logger.error(
        `Failed to clear journey metrics for ${journeyId}: ${(error as Error).message}`,
        'JourneyMetricsService',
      );
    }
  }
}
