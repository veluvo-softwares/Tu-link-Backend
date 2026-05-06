/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseService } from '../../../shared/firebase/firebase.service';
import { RedisService } from '../../../shared/redis/redis.service';
import { Participant } from '../../../shared/interfaces/participant.interface';
import { FieldValue } from 'firebase-admin/firestore';

@Injectable()
export class ParticipantService {
  constructor(
    private firebaseService: FirebaseService,
    private redisService: RedisService,
  ) {}

  async addParticipant(
    journeyId: string,
    userId: string,
    invitedBy: string,
    role: 'LEADER' | 'FOLLOWER' = 'FOLLOWER',
  ): Promise<Participant> {
    const participantRef = this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .doc(userId);

    const participantData: any = {
      userId,
      journeyId,
      role,
      status: role === 'LEADER' ? 'ACTIVE' : 'INVITED',
      invitedBy,
      connectionStatus: 'DISCONNECTED',
    };

    // Only add joinedAt for leader (invited followers get it when they accept)
    if (role === 'LEADER') {
      participantData.joinedAt = FieldValue.serverTimestamp();
    }

    await participantRef.set(participantData);

    // Update Redis if it's the leader
    if (role === 'LEADER') {
      await this.redisService.setJourneyLeader(journeyId, userId);
    }

    return { id: userId, ...participantData } as Participant;
  }

  async acceptInvitation(journeyId: string, userId: string): Promise<void> {
    const participantRef = this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .doc(userId);

    const participantDoc = await participantRef.get();
    if (!participantDoc.exists) {
      throw new NotFoundException('Invitation not found');
    }

    await participantRef.update({
      status: 'ACCEPTED',
      joinedAt: FieldValue.serverTimestamp(),
    });
  }

  async declineInvitation(journeyId: string, userId: string): Promise<void> {
    const participantRef = this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .doc(userId);

    const participantDoc = await participantRef.get();
    if (!participantDoc.exists) {
      throw new NotFoundException('Invitation not found');
    }

    await participantRef.update({
      status: 'DECLINED',
    });
  }

  async leaveJourney(journeyId: string, userId: string): Promise<void> {
    const participantRef = this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .doc(userId);

    const participantDoc = await participantRef.get();
    if (!participantDoc.exists) {
      throw new NotFoundException('Participant not found');
    }

    const participant = participantDoc.data() as Participant;
    if (participant.role === 'LEADER') {
      throw new ForbiddenException('Leader cannot leave journey');
    }

    await participantRef.update({
      status: 'LEFT',
      leftAt: FieldValue.serverTimestamp(),
    });

    // Remove from Redis
    await this.redisService.removeJourneyParticipant(journeyId, userId);
  }

  async getJourneyParticipants(journeyId: string): Promise<Participant[]> {
    const snapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .get();

    const participants = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Participant[];

    // Fetch user details for each participant to include displayName
    const enrichedParticipants = await Promise.all(
      participants.map(async (participant) => {
        try {
          const userDoc = await this.firebaseService.firestore
            .collection('users')
            .doc(participant.userId)
            .get();

          const userData = userDoc.data();
          return {
            ...participant,
            displayName: (userData?.displayName as string) || 'Unknown User',
          };
        } catch (error) {
          // If user fetch fails, return participant with fallback displayName
          console.error(`Failed to fetch user ${participant.userId}:`, error);
          return {
            ...participant,
            displayName: 'Unknown User',
          };
        }
      }),
    );

    return enrichedParticipants;
  }

  async isParticipant(journeyId: string, userId: string): Promise<boolean> {
    const participantDoc = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .doc(userId)
      .get();

    return participantDoc.exists;
  }

  async isActiveParticipant(
    journeyId: string,
    userId: string,
  ): Promise<boolean> {
    const participantDoc = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .doc(userId)
      .get();

    if (!participantDoc.exists) return false;

    const participant = participantDoc.data() as Participant;
    return participant.status === 'ACTIVE' || participant.status === 'ACCEPTED';
  }

  async updateConnectionStatus(
    journeyId: string,
    userId: string,
    status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING',
  ): Promise<void> {
    await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .doc(userId)
      .update({
        connectionStatus: status,
        lastSeenAt: FieldValue.serverTimestamp(),
      });
  }
}
