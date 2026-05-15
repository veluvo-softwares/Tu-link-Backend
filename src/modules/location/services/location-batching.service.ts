import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server } from 'socket.io';
import { LoggerService } from '../../../shared/logger/logger.service';
import { LocationUpdate } from '../../../shared/interfaces/location.interface';
import { BatchData } from '../../../shared/interfaces/websocket-strategy.interface';

@Injectable()
export class LocationBatchingService {
  private batches = new Map<string, BatchData>();

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Add a location update to the batch for a journey
   */
  async addToBatch(journeyId: string, update: LocationUpdate): Promise<void> {
    try {
      const batchIntervalMs =
        this.configService.get<number>('app.websocket.batchIntervalMs') || 2500;
      const maxBatchSize =
        this.configService.get<number>('app.websocket.maxBatchSize') || 50;
      const maxBatchDelayMs =
        this.configService.get<number>('app.websocket.maxBatchDelayMs') || 3000;

      // Get or create batch for this journey
      let batch = this.batches.get(journeyId);

      if (!batch) {
        // Create new batch
        batch = {
          updates: [],
          timeout: null,
          createdAt: Date.now(),
          participantCount: 1,
        };
        this.batches.set(journeyId, batch);
      }

      // Add update to batch
      batch.updates.push(update);

      // Update participant count (count unique participants)
      const uniqueParticipants = new Set(
        batch.updates.map((u) => u.participantId),
      );
      batch.participantCount = uniqueParticipants.size;

      // Clear existing timeout if any
      if (batch.timeout) {
        clearTimeout(batch.timeout);
      }

      // Check if we should flush immediately
      const shouldFlushImmediately =
        batch.updates.length >= maxBatchSize ||
        Date.now() - batch.createdAt >= maxBatchDelayMs;

      if (shouldFlushImmediately) {
        await this.flushBatch(journeyId);
      } else {
        // Schedule batch flush
        batch.timeout = setTimeout(() => {
          this.flushBatch(journeyId).catch((error) => {
            this.logger.error(
              `Error flushing batch for journey ${journeyId}: ${(error as Error).message}`,
              'LocationBatchingService',
            );
          });
        }, batchIntervalMs);
      }

      this.logger.debug(
        `Added update to batch for journey ${journeyId}. Batch size: ${batch.updates.length}`,
        'LocationBatchingService',
      );
    } catch (error) {
      this.logger.error(
        `Failed to add update to batch for journey ${journeyId}: ${(error as Error).message}`,
        'LocationBatchingService',
      );
    }
  }

  /**
   * Flush (broadcast) the batch for a journey
   */
  // Async by design — kept Promise-returning for the batching service API;
  // callers use `await` / `.catch()`. No awaited work in the current impl.
  // eslint-disable-next-line @typescript-eslint/require-await
  private async flushBatch(journeyId: string): Promise<void> {
    try {
      const batch = this.batches.get(journeyId);
      if (!batch || batch.updates.length === 0) {
        return;
      }

      // Clear timeout
      if (batch.timeout) {
        clearTimeout(batch.timeout);
      }

      // Remove batch from memory
      this.batches.delete(journeyId);

      // Log batch flush
      this.logger.info(
        `Flushing batch for journey ${journeyId}: ${batch.updates.length} updates, ${batch.participantCount} participants`,
        'LocationBatchingService',
      );

      // Broadcast will be handled by the gateway that calls this service
      // We just need to return the updates to be broadcasted
    } catch (error) {
      this.logger.error(
        `Failed to flush batch for journey ${journeyId}: ${(error as Error).message}`,
        'LocationBatchingService',
      );
    }
  }

  /**
   * Get and flush current batch for a journey
   */
  // Async by design — kept Promise-returning for the batching service API.
  // eslint-disable-next-line @typescript-eslint/require-await
  async getAndFlushBatch(journeyId: string): Promise<LocationUpdate[]> {
    try {
      const batch = this.batches.get(journeyId);
      if (!batch || batch.updates.length === 0) {
        return [];
      }

      const updates = [...batch.updates];

      // Clear batch
      if (batch.timeout) {
        clearTimeout(batch.timeout);
      }
      this.batches.delete(journeyId);

      this.logger.debug(
        `Retrieved and flushed batch for journey ${journeyId}: ${updates.length} updates`,
        'LocationBatchingService',
      );

      return updates;
    } catch (error) {
      this.logger.error(
        `Failed to get batch for journey ${journeyId}: ${(error as Error).message}`,
        'LocationBatchingService',
      );
      return [];
    }
  }

  /**
   * Get current batch size for a journey
   */
  getBatchSize(journeyId: string): number {
    const batch = this.batches.get(journeyId);
    return batch ? batch.updates.length : 0;
  }

  /**
   * Get time until next flush for a journey
   */
  getTimeUntilNextFlush(journeyId: string): number {
    const batch = this.batches.get(journeyId);
    if (!batch) {
      return 0;
    }

    const batchIntervalMs =
      this.configService.get<number>('app.websocket.batchIntervalMs') || 2500;
    const elapsed = Date.now() - batch.createdAt;
    const remaining = Math.max(0, batchIntervalMs - elapsed);

    return remaining;
  }

  /**
   * Clear all batches (cleanup on service shutdown)
   */
  clearAllBatches(): void {
    for (const batch of this.batches.values()) {
      if (batch.timeout) {
        clearTimeout(batch.timeout);
      }
    }
    this.batches.clear();
    this.logger.info('Cleared all location batches', 'LocationBatchingService');
  }

  /**
   * Schedule periodic flush for all batches
   */
  startPeriodicFlush(server: Server): void {
    const batchIntervalMs =
      this.configService.get<number>('app.websocket.batchIntervalMs') || 2500;

    setInterval(() => {
      this.flushAllBatches(server).catch((error) => {
        this.logger.error(
          `Error in periodic batch flush: ${(error as Error).message}`,
          'LocationBatchingService',
        );
      });
    }, batchIntervalMs);

    this.logger.info(
      'Started periodic batch flushing',
      'LocationBatchingService',
    );
  }

  /**
   * Flush all active batches
   */
  private async flushAllBatches(server: Server): Promise<void> {
    const journeyIds = Array.from(this.batches.keys());

    for (const journeyId of journeyIds) {
      try {
        const updates = await this.getAndFlushBatch(journeyId);

        if (updates.length > 0) {
          // Broadcast batched updates
          server.to(`journey:${journeyId}`).emit('batched-location-updates', {
            updates,
            count: updates.length,
            timestamp: Date.now(),
            strategy: 'BATCHED',
          });
        }
      } catch (error) {
        this.logger.error(
          `Error flushing batch for journey ${journeyId}: ${(error as Error).message}`,
          'LocationBatchingService',
        );
      }
    }
  }
}
