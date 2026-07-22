import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../shared/redis/redis.service';
import { LocationRepository } from '../../../database/repositories/location.repository';

@Injectable()
export class SequenceService {
  constructor(
    private redisService: RedisService,
    private locationRepository: LocationRepository,
  ) {}

  /**
   * Generate next sequence number for a journey
   */
  async getNextSequence(journeyId: string): Promise<number> {
    const sequenceKey = `journey:${journeyId}:seq`;
    const exists = await this.redisService.getClient().exists(sequenceKey);
    const durableFloor = exists
      ? 0
      : await this.locationRepository.getMaxSequence(journeyId);
    return await this.redisService.getNextSequence(journeyId, durableFloor);
  }

  /**
   * Get last acknowledged sequence for a participant
   */
  async getLastAcknowledged(participantId: string): Promise<number> {
    return await this.redisService.getLastAcknowledgedSequence(participantId);
  }

  /**
   * Update last acknowledged sequence for a participant
   */
  async updateLastAcknowledged(
    participantId: string,
    sequenceNumber: number,
  ): Promise<void> {
    await this.redisService.setLastAcknowledgedSequence(
      participantId,
      sequenceNumber,
    );
  }

  /**
   * Detect sequence gaps (missing messages)
   */
  async detectGaps(
    participantId: string,
    currentSequence: number,
  ): Promise<number[]> {
    const lastAcknowledged = await this.getLastAcknowledged(participantId);
    const gaps: number[] = [];

    // If there's a gap between last acknowledged and current
    if (currentSequence > lastAcknowledged + 1) {
      for (let i = lastAcknowledged + 1; i < currentSequence; i++) {
        gaps.push(i);
      }
    }

    return gaps;
  }

  /**
   * Check if resync is needed based on gap size
   */
  needsResync(gaps: number[]): boolean {
    return gaps.length > 10; // Resync if more than 10 messages missing
  }
}
