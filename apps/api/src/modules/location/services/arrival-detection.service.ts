import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParticipantRepository } from '../../../database/repositories/participant.repository';
import { LocationUpdate } from '../../../shared/interfaces/location.interface';
import { Journey } from '../../../shared/interfaces/journey.interface';
import { DistanceUtils } from '../../../common/utils/distance.utils';

export interface ArrivalResult {
  arrived: boolean;
  alreadyArrived: boolean;
  arrivedCount: number;
  totalCount: number;
  allArrived: boolean;
}

@Injectable()
export class ArrivalDetectionService {
  constructor(
    private participantRepository: ParticipantRepository,
    private configService: ConfigService,
  ) {}

  async detectArrival(
    update: LocationUpdate,
    journey: Journey,
  ): Promise<ArrivalResult> {
    const noArrival: ArrivalResult = {
      arrived: false,
      alreadyArrived: false,
      arrivedCount: 0,
      totalCount: 0,
      allArrived: false,
    };

    if (!journey.destination) {
      return noArrival;
    }

    const destinationCoords = {
      latitude: journey.destination.latitude,
      longitude: journey.destination.longitude,
    };

    const distanceToDestination = DistanceUtils.haversineDistance(
      update.location,
      destinationCoords,
    );

    const distanceThreshold =
      this.configService.get<number>('app.arrivalDistanceThresholdMeters') ??
      100;
    const speedThreshold =
      this.configService.get<number>('app.arrivalSpeedThresholdMps') ?? 1.39;

    const isWithinDistance = distanceToDestination < distanceThreshold;
    const isLowSpeed = !update.speed || update.speed < speedThreshold;

    if (!isWithinDistance || !isLowSpeed) {
      return noArrival;
    }

    const markResult = await this.markParticipantArrived(
      update.participantId,
      journey.id,
    );

    // No participant row — nothing arrived, so do not report a (false) arrival.
    if (!markResult.found) {
      return noArrival;
    }

    if (markResult.alreadyArrived) {
      return { ...noArrival, alreadyArrived: true };
    }

    const { arrivedCount, totalCount } = await this.getArrivalCounts(
      journey.id,
    );

    return {
      arrived: true,
      alreadyArrived: false,
      arrivedCount,
      totalCount,
      allArrived: arrivedCount >= totalCount && totalCount > 0,
    };
  }

  private async markParticipantArrived(
    participantId: string,
    journeyId: string,
  ): Promise<{ found: boolean; alreadyArrived: boolean }> {
    const participant = await this.participantRepository.findOne(
      journeyId,
      participantId,
    );

    if (!participant) {
      return { found: false, alreadyArrived: false };
    }

    // Atomic, race-safe transition: only one concurrent request flips the
    // status, the rest see null and are treated as already-arrived (no
    // duplicate arrival side effects).
    const updated = await this.participantRepository.markArrivedIfNotArrived(
      journeyId,
      participantId,
    );

    return { found: true, alreadyArrived: updated === null };
  }

  /**
   * Returns how many active participants have arrived vs total active participants.
   * Leader is included — they must also arrive or manually end for allArrived to be true.
   */
  async getArrivalCounts(
    journeyId: string,
  ): Promise<{ arrivedCount: number; totalCount: number }> {
    const participants =
      await this.participantRepository.findByJourney(journeyId);
    const relevant = participants.filter((p) =>
      ['ACTIVE', 'ACCEPTED', 'ARRIVED'].includes(p.status),
    );
    const arrivedCount = relevant.filter((p) => p.status === 'ARRIVED').length;
    const totalCount = relevant.length;

    return { arrivedCount, totalCount };
  }

  async getArrivedParticipants(journeyId: string): Promise<string[]> {
    const participants =
      await this.participantRepository.findByJourney(journeyId);
    return participants
      .filter((p) => p.status === 'ARRIVED')
      .map((p) => p.userId);
  }

  async allParticipantsArrived(journeyId: string): Promise<boolean> {
    const { arrivedCount, totalCount } = await this.getArrivalCounts(journeyId);
    return totalCount > 0 && arrivedCount >= totalCount;
  }
}
