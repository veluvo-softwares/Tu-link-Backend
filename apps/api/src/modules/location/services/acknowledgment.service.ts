/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../shared/redis/redis.service';
import { LocationUpdate } from '../../../shared/interfaces/location.interface';
import { Priority } from '../../../types/priority.type';
import { RetryUtils } from '../../../common/utils/retry.utils';

@Injectable()
export class AcknowledgmentService {
  constructor(
    private redisService: RedisService,
    private configService: ConfigService,
  ) {}

  /**
   * Check if acknowledgment is required for this update
   */
  requiresAcknowledgment(priority: Priority): boolean {
    // Only HIGH priority messages require acknowledgment
    return priority === 'HIGH';
  }

  /**
   * Store pending delivery for retry
   */
  async addPendingDelivery(
    journeyId: string,
    participantId: string,
    update: LocationUpdate,
  ): Promise<void> {
    await this.redisService.addPendingDelivery(journeyId, participantId, {
      ...update,
      timestamp: Date.now(),
      attempt: 0,
    });
  }

  /**
   * Get pending deliveries for a participant
   */
  async getPendingDeliveries(
    journeyId: string,
    participantId: string,
  ): Promise<any[]> {
    return await this.redisService.getPendingDeliveries(
      journeyId,
      participantId,
    );
  }

  /**
   * Remove pending delivery after successful acknowledgment
   */
  async removePendingDelivery(
    journeyId: string,
    participantId: string,
  ): Promise<void> {
    await this.redisService.removePendingDelivery(journeyId, participantId);
  }

  /**
   * Retry pending deliveries with exponential backoff
   */
  async retryPendingDeliveries(
    journeyId: string,
    participantId: string,
    retryFn: (update: any) => Promise<void>,
  ): Promise<void> {
    const pending = await this.getPendingDeliveries(journeyId, participantId);
    const maxAttempts = this.configService.get('app.maxRetryAttempts');

    for (const item of pending) {
      if (item.attempt >= maxAttempts) {
        console.error(
          `Max retry attempts reached for participant ${participantId}`,
        );
        continue;
      }

      try {
        await RetryUtils.retryWithBackoff(
          async () => await retryFn(item),
          maxAttempts - item.attempt,
        );

        // Success - remove from pending
        await this.removePendingDelivery(journeyId, participantId);
      } catch (error) {
        console.error(`Retry failed for participant ${participantId}:`, error);

        // Update attempt count
        item.attempt++;
        await this.redisService.removePendingDelivery(journeyId, participantId);
        await this.redisService.addPendingDelivery(
          journeyId,
          participantId,
          item,
        );
      }
    }
  }

  /**
   * Start acknowledgment timeout
   */
  startAckTimeout(
    journeyId: string,
    participantId: string,
    sequenceNumber: number,
    timeoutCallback: () => void,
  ): NodeJS.Timeout {
    const timeout = this.configService.get('app.retryTimeoutMs');

    return setTimeout(() => {
      console.warn(
        `ACK timeout for participant ${participantId}, sequence ${sequenceNumber}`,
      );
      timeoutCallback();
    }, timeout);
  }

  /**
   * Clear acknowledgment timeout
   */
  clearAckTimeout(timeout: NodeJS.Timeout): void {
    clearTimeout(timeout);
  }
}
