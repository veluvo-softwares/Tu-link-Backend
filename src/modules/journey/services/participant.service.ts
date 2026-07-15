import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from '../../../shared/redis/redis.service';
import { ParticipantRepository } from '../../../database/repositories/participant.repository';
import { Participant } from '../../../shared/interfaces/participant.interface';

@Injectable()
export class ParticipantService {
  constructor(
    private participantRepository: ParticipantRepository,
    private redisService: RedisService,
  ) {}

  async addParticipant(
    journeyId: string,
    userId: string,
    invitedBy: string,
    role: 'LEADER' | 'FOLLOWER' = 'FOLLOWER',
  ): Promise<Participant> {
    const participant = await this.participantRepository.add({
      journeyId,
      userId,
      invitedBy,
      role,
      status: role === 'LEADER' ? 'ACTIVE' : 'INVITED',
      // Leader joins immediately; invited followers get joinedAt on accept.
      setJoinedAt: role === 'LEADER',
    });

    // Update Redis if it's the leader
    if (role === 'LEADER') {
      await this.redisService.setJourneyLeader(journeyId, userId);
    }

    return participant as unknown as Participant;
  }

  async acceptInvitation(journeyId: string, userId: string): Promise<void> {
    const updated = await this.participantRepository.accept(journeyId, userId);
    if (!updated) {
      throw new NotFoundException('Invitation not found');
    }
  }

  async declineInvitation(journeyId: string, userId: string): Promise<void> {
    const updated = await this.participantRepository.decline(journeyId, userId);
    if (!updated) {
      throw new NotFoundException('Invitation not found');
    }
  }

  async leaveJourney(journeyId: string, userId: string): Promise<void> {
    const participant = await this.participantRepository.findOne(
      journeyId,
      userId,
    );
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }
    if (participant.role === 'LEADER') {
      throw new ForbiddenException('Leader cannot leave journey');
    }

    await this.participantRepository.leave(journeyId, userId);

    // Remove from Redis
    await this.redisService.removeJourneyParticipant(journeyId, userId);
  }

  async getJourneyParticipants(journeyId: string): Promise<Participant[]> {
    // Repository JOINs users.display_name in one query (no per-participant fetch).
    const participants =
      await this.participantRepository.findByJourney(journeyId);
    return participants as unknown as Participant[];
  }

  async getParticipant(
    journeyId: string,
    userId: string,
  ): Promise<Participant | null> {
    const participant = await this.participantRepository.findOne(
      journeyId,
      userId,
    );
    return participant as unknown as Participant | null;
  }

  // Participant records for a user across journeys (replaces collectionGroup).
  async getUserParticipations(
    userId: string,
    statuses?: ('INVITED' | 'ACCEPTED' | 'ACTIVE' | 'ARRIVED' | 'LEFT')[],
  ): Promise<Participant[]> {
    const participants = await this.participantRepository.findByUser(
      userId,
      statuses,
    );
    return participants as unknown as Participant[];
  }

  // Active-journey accept path: promote an existing invite straight to ACTIVE.
  async markActive(journeyId: string, userId: string): Promise<void> {
    const updated = await this.participantRepository.activate(
      journeyId,
      userId,
    );
    if (!updated) {
      throw new NotFoundException('Invitation not found');
    }
  }

  // journey.start(): bulk-promote ACCEPTED participants + the leader to ACTIVE.
  async activateForStart(journeyId: string): Promise<void> {
    await this.participantRepository.activateForStart(journeyId);
  }

  async isParticipant(journeyId: string, userId: string): Promise<boolean> {
    const participant = await this.participantRepository.findOne(
      journeyId,
      userId,
    );
    if (!participant) return false;
    return (
      ['ACTIVE', 'ACCEPTED', 'ARRIVED'].includes(participant.status) ||
      participant.role === 'LEADER'
    );
  }

  async isActiveParticipant(
    journeyId: string,
    userId: string,
  ): Promise<boolean> {
    const participant = await this.participantRepository.findOne(
      journeyId,
      userId,
    );
    if (!participant) return false;
    // ARRIVED members remain part of an ACTIVE journey until the whole convoy
    // completes. Their clients keep sending stationary beacons so peers can
    // see them at the destination; rejecting those updates creates an error
    // storm and corrupts journey health metrics.
    return ['ACTIVE', 'ACCEPTED', 'ARRIVED'].includes(participant.status);
  }

  async updateConnectionStatus(
    journeyId: string,
    userId: string,
    status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING',
  ): Promise<void> {
    await this.participantRepository.setConnectionStatus(
      journeyId,
      userId,
      status,
    );
  }
}
