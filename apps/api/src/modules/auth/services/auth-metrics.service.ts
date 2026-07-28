import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../shared/redis/redis.service';
import { LoggerService } from '../../../shared/logger/logger.service';

@Injectable()
export class AuthMetricsService {
  constructor(
    private readonly redisService: RedisService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Record a transient_bypass event: a best-effort revocation bypass that
   * occurred because Firebase was transiently unavailable. Always emits a
   * structured warn log; the Redis counter increment is best-effort and
   * never causes this method to throw.
   */
  async recordTransientBypass(uid: string, errorCode: string): Promise<void> {
    this.logger.warn(
      'Auth revocation check bypassed (transient)',
      'AuthMetricsService',
      {
        event: 'transient_bypass',
        uid,
        errorCode,
        timestamp: new Date().toISOString(),
      },
    );

    try {
      await this.redisService
        .getClient()
        .incr('auth:metrics:transient_bypass:total');
    } catch (error) {
      this.logger.warn(
        `Failed to increment transient_bypass counter: ${(error as Error).message}`,
        'AuthMetricsService',
      );
    }
  }
}
