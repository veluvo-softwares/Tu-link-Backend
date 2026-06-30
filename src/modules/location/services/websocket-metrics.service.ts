import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../shared/redis/redis.service';
import { LoggerService } from '../../../shared/logger/logger.service';
import {
  PerformanceMetrics,
  LocationStrategy,
} from '../../../shared/interfaces/websocket-strategy.interface';

interface StrategyMetrics {
  totalRequests: number;
  totalLatency: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  errorCount: number;
  errorRate: number;
  lastUpdated: number;
}

@Injectable()
export class WebSocketMetricsService {
  private readonly METRICS_TTL = 3600; // 1 hour

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Track broadcast metrics for a journey and strategy
   */
  async trackBroadcastMetrics(
    journeyId: string,
    strategy: LocationStrategy,
    latency: number,
    isError = false,
  ): Promise<void> {
    try {
      const metricsKey = `websocket_metrics:${journeyId}:${strategy}`;

      // Get existing metrics or create new ones
      const cachedData = await this.redisService.getClient().get(metricsKey);
      let metrics = cachedData
        ? (JSON.parse(cachedData) as StrategyMetrics)
        : null;

      if (!metrics) {
        metrics = {
          totalRequests: 0,
          totalLatency: 0,
          avgLatency: 0,
          minLatency: latency,
          maxLatency: latency,
          errorCount: 0,
          errorRate: 0,
          lastUpdated: Date.now(),
        };
      }

      // Update metrics
      metrics.totalRequests += 1;
      metrics.totalLatency += latency;
      metrics.avgLatency = metrics.totalLatency / metrics.totalRequests;
      metrics.minLatency = Math.min(metrics.minLatency, latency);
      metrics.maxLatency = Math.max(metrics.maxLatency, latency);

      if (isError) {
        metrics.errorCount += 1;
      }
      metrics.errorRate = (metrics.errorCount / metrics.totalRequests) * 100;
      metrics.lastUpdated = Date.now();

      // Store updated metrics with TTL
      await this.redisService
        .getClient()
        .setex(metricsKey, this.METRICS_TTL, JSON.stringify(metrics));

      // Log performance warnings
      this.checkPerformanceThresholds(journeyId, strategy, metrics);
    } catch (error) {
      this.logger.error(
        `Failed to track broadcast metrics for journey ${journeyId}, strategy ${strategy}: ${(error as Error).message}`,
        'WebSocketMetricsService',
      );
    }
  }

  /**
   * Get performance report for a journey
   */
  async getPerformanceReport(journeyId: string): Promise<PerformanceMetrics[]> {
    try {
      const strategies: LocationStrategy[] = ['REALTIME', 'BATCHED', 'POLLING'];
      const reports: PerformanceMetrics[] = [];

      for (const strategy of strategies) {
        const metricsKey = `websocket_metrics:${journeyId}:${strategy}`;
        const cached = await this.redisService.getClient().get(metricsKey);
        const metrics = cached ? (JSON.parse(cached) as StrategyMetrics) : null;

        if (metrics && metrics.totalRequests > 0) {
          reports.push({
            journeyId,
            strategy,
            avgLatency: metrics.avgLatency,
            messageCount: metrics.totalRequests,
            errorRate: metrics.errorRate,
            lastMeasured: metrics.lastUpdated,
          });
        }
      }

      return reports;
    } catch (error) {
      this.logger.error(
        `Failed to get performance report for journey ${journeyId}: ${(error as Error).message}`,
        'WebSocketMetricsService',
      );
      return [];
    }
  }

  /**
   * Get aggregated performance metrics across all journeys
   */
  async getAggregatedMetrics(): Promise<
    Record<LocationStrategy, PerformanceMetrics>
  > {
    try {
      const strategies: LocationStrategy[] = ['REALTIME', 'BATCHED', 'POLLING'];
      const aggregated = {} as Record<LocationStrategy, PerformanceMetrics>;

      for (const strategy of strategies) {
        const pattern = `websocket_metrics:*:${strategy}`;
        const keys = await this.redisService.getClient().keys(pattern);

        let totalLatency = 0;
        let totalMessages = 0;
        let totalErrors = 0;
        let latestTimestamp = 0;

        for (const key of keys) {
          const cached = await this.redisService.getClient().get(key);
          const metrics = cached
            ? (JSON.parse(cached) as StrategyMetrics)
            : null;
          if (metrics) {
            totalLatency += metrics.totalLatency;
            totalMessages += metrics.totalRequests;
            totalErrors += metrics.errorCount;
            latestTimestamp = Math.max(latestTimestamp, metrics.lastUpdated);
          }
        }

        if (totalMessages > 0) {
          aggregated[strategy] = {
            journeyId: 'aggregated',
            strategy,
            avgLatency: totalLatency / totalMessages,
            messageCount: totalMessages,
            errorRate: (totalErrors / totalMessages) * 100,
            lastMeasured: latestTimestamp,
          };
        }
      }

      return aggregated;
    } catch (error) {
      this.logger.error(
        `Failed to get aggregated metrics: ${(error as Error).message}`,
        'WebSocketMetricsService',
      );
      return {} as Record<LocationStrategy, PerformanceMetrics>;
    }
  }

  /**
   * Track strategy switch for a journey
   */
  async trackStrategySwitch(
    journeyId: string,
    fromStrategy: LocationStrategy,
    toStrategy: LocationStrategy,
    participantCount: number,
  ): Promise<void> {
    try {
      const switchKey = `strategy_switches:${journeyId}`;
      const switchData = {
        fromStrategy,
        toStrategy,
        participantCount,
        timestamp: Date.now(),
      };

      await this.redisService
        .getClient()
        .lpush(switchKey, JSON.stringify(switchData));
      await this.redisService.getClient().expire(switchKey, this.METRICS_TTL);

      this.logger.info(
        `Strategy switch for journey ${journeyId}: ${fromStrategy} -> ${toStrategy} (${participantCount} participants)`,
        'WebSocketMetricsService',
      );
    } catch (error) {
      this.logger.error(
        `Failed to track strategy switch for journey ${journeyId}: ${(error as Error).message}`,
        'WebSocketMetricsService',
      );
    }
  }

  /**
   * Get bandwidth usage estimate for a journey
   */
  async getBandwidthUsage(journeyId: string): Promise<Record<string, number>> {
    try {
      const strategies: LocationStrategy[] = ['REALTIME', 'BATCHED', 'POLLING'];
      const usage: Record<string, number> = {};

      for (const strategy of strategies) {
        const metricsKey = `websocket_metrics:${journeyId}:${strategy}`;
        const cached = await this.redisService.getClient().get(metricsKey);
        const metrics = cached ? (JSON.parse(cached) as StrategyMetrics) : null;

        if (metrics) {
          // Rough estimate: each location update is ~200 bytes
          const estimatedBytesPerUpdate = 200;
          const totalBandwidth =
            metrics.totalRequests * estimatedBytesPerUpdate;
          usage[strategy] = totalBandwidth;
        }
      }

      return usage;
    } catch (error) {
      this.logger.error(
        `Failed to get bandwidth usage for journey ${journeyId}: ${(error as Error).message}`,
        'WebSocketMetricsService',
      );
      return {};
    }
  }

  /**
   * Clear metrics for a journey (called when journey ends)
   */
  async clearJourneyMetrics(journeyId: string): Promise<void> {
    try {
      const patterns = [
        `websocket_metrics:${journeyId}:*`,
        `strategy_switches:${journeyId}`,
      ];

      for (const pattern of patterns) {
        const keys = await this.redisService.getClient().keys(pattern);
        for (const key of keys) {
          await this.redisService.getClient().del(key);
        }
      }

      this.logger.info(
        `Cleared metrics for journey ${journeyId}`,
        'WebSocketMetricsService',
      );
    } catch (error) {
      this.logger.error(
        `Failed to clear metrics for journey ${journeyId}: ${(error as Error).message}`,
        'WebSocketMetricsService',
      );
    }
  }

  /**
   * Record a force_disconnect event: sockets *targeted* for force-disconnect
   * for a uid as a result of the user logging out. `socketCount` is the size
   * of the room at fetch time, not a post-disconnect confirmation -- socket.io's
   * disconnectSockets() returns void, so there is no way to confirm how many
   * sockets were actually torn down. Always emits a structured info log; the
   * Redis counter increment is best-effort and never causes this method to
   * throw (mirrors AuthMetricsService.recordTransientBypass).
   */
  async recordForceDisconnect(uid: string, socketCount: number): Promise<void> {
    this.logger.info(
      'WebSocket force-disconnect targeted on logout',
      'WebSocketMetricsService',
      {
        event: 'force_disconnect',
        uid,
        socketCount,
        timestamp: new Date().toISOString(),
      },
    );

    try {
      await this.redisService
        .getClient()
        .incrby('websocket:metrics:force_disconnect:total', socketCount);
    } catch (error) {
      this.logger.warn(
        `Failed to increment force_disconnect counter: ${(error as Error).message}`,
        'WebSocketMetricsService',
      );
    }
  }

  /**
   * Check performance thresholds and log warnings
   */
  private checkPerformanceThresholds(
    journeyId: string,
    strategy: LocationStrategy,
    metrics: StrategyMetrics,
  ): void {
    const thresholds = {
      REALTIME: { maxLatency: 100, maxErrorRate: 5 },
      BATCHED: { maxLatency: 3000, maxErrorRate: 10 },
      POLLING: { maxLatency: 10000, maxErrorRate: 15 },
    };

    const threshold = thresholds[strategy];

    if (metrics.avgLatency > threshold.maxLatency) {
      this.logger.warn(
        `High latency detected for journey ${journeyId} (${strategy}): ${metrics.avgLatency}ms > ${threshold.maxLatency}ms`,
        'WebSocketMetricsService',
      );
    }

    if (metrics.errorRate > threshold.maxErrorRate) {
      this.logger.warn(
        `High error rate detected for journey ${journeyId} (${strategy}): ${metrics.errorRate}% > ${threshold.maxErrorRate}%`,
        'WebSocketMetricsService',
      );
    }
  }

  /**
   * Generate performance health check
   */
  async getHealthCheck(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    metrics: Record<string, any>;
  }> {
    try {
      const aggregated = await this.getAggregatedMetrics();
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';

      for (const metrics of Object.values(aggregated)) {
        if (metrics.errorRate > 20) {
          status = 'critical';
          break;
        } else if (metrics.errorRate > 10) {
          status = 'warning';
        }
      }

      return {
        status,
        metrics: {
          aggregated,
          timestamp: Date.now(),
          totalStrategies: Object.keys(aggregated).length,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate health check: ${(error as Error).message}`,
        'WebSocketMetricsService',
      );
      return {
        status: 'critical',
        metrics: { error: (error as Error).message },
      };
    }
  }
}
