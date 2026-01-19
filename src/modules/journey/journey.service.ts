import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { RedisService } from '../../shared/redis/redis.service';
import { ParticipantService } from './services/participant.service';
import { CreateJourneyDto } from './dto/create-journey.dto';
import { UpdateJourneyDto } from './dto/update-journey.dto';
import { Journey } from '../../shared/interfaces/journey.interface';
import { JourneyStatus } from '../../types/journey-status.type';
import { FieldValue, GeoPoint } from 'firebase-admin/firestore';

@Injectable()
export class JourneyService {
  constructor(
    private firebaseService: FirebaseService,
    private redisService: RedisService,
    private participantService: ParticipantService,
    private configService: ConfigService,
  ) {}

  async create(userId: string, createJourneyDto: CreateJourneyDto): Promise<Journey> {
    const journeyRef = this.firebaseService.firestore.collection('journeys').doc();

    const journeyData = {
      name: createJourneyDto.name,
      leaderId: userId,
      status: 'PENDING' as const,
      destination: createJourneyDto.destination
        ? new GeoPoint(
            createJourneyDto.destination.latitude,
            createJourneyDto.destination.longitude,
          )
        : undefined,
      destinationAddress: createJourneyDto.destinationAddress,
      lagThresholdMeters:
        createJourneyDto.lagThresholdMeters ||
        this.configService.get('app.defaultLagThresholdMeters') ||
        500,
      createdAt: FieldValue.serverTimestamp() as any,
      updatedAt: FieldValue.serverTimestamp() as any,
      metadata: {},
    };

    await journeyRef.set(journeyData);

    // Add creator as leader participant
    await this.participantService.addParticipant(journeyRef.id, userId, userId, 'LEADER');

    return { id: journeyRef.id, ...journeyData } as Journey;
  }

  async findById(journeyId: string): Promise<Journey> {
    const journeyDoc = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .get();

    if (!journeyDoc.exists) {
      throw new NotFoundException('Journey not found');
    }

    return { id: journeyDoc.id, ...journeyDoc.data() } as Journey;
  }

  async update(
    journeyId: string,
    userId: string,
    updateJourneyDto: UpdateJourneyDto,
  ): Promise<Journey> {
    const journey = await this.findById(journeyId);

    if (journey.leaderId !== userId) {
      throw new ForbiddenException('Only leader can update journey');
    }

    if (journey.status !== 'PENDING') {
      throw new BadRequestException('Can only update pending journeys');
    }

    const updateData: any = {
      ...updateJourneyDto,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (updateJourneyDto.destination) {
      updateData.destination = new GeoPoint(
        updateJourneyDto.destination.latitude,
        updateJourneyDto.destination.longitude,
      );
    }

    await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .update(updateData);

    return this.findById(journeyId);
  }

  async delete(journeyId: string, userId: string): Promise<void> {
    const journey = await this.findById(journeyId);

    if (journey.leaderId !== userId) {
      throw new ForbiddenException('Only leader can delete journey');
    }

    if (journey.status === 'ACTIVE') {
      throw new BadRequestException('Cannot delete active journey');
    }

    await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .update({
        status: 'CANCELLED',
        endTime: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
  }

  async start(journeyId: string, userId: string): Promise<Journey> {
    const journey = await this.findById(journeyId);

    if (journey.leaderId !== userId) {
      throw new ForbiddenException('Only leader can start journey');
    }

    if (journey.status !== 'PENDING') {
      throw new BadRequestException('Journey already started or completed');
    }

    await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .update({
        status: 'ACTIVE',
        startTime: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    // Update all accepted participants to active
    const participants = await this.participantService.getJourneyParticipants(journeyId);
    const updates = participants
      .filter((p) => p.status === 'ACCEPTED' || p.role === 'LEADER')
      .map((p) =>
        this.firebaseService.firestore
          .collection('journeys')
          .doc(journeyId)
          .collection('participants')
          .doc(p.userId)
          .update({ status: 'ACTIVE' }),
      );

    await Promise.all(updates);

    // Add to active journeys in Redis
    await this.redisService.addActiveJourney(journeyId);

    // Cache participants in Redis
    const activeParticipants = participants.filter(
      (p) => p.status === 'ACCEPTED' || p.role === 'LEADER',
    );
    for (const participant of activeParticipants) {
      await this.redisService.addParticipantToJourney(journeyId, participant.userId);
    }

    return this.findById(journeyId);
  }

  async end(journeyId: string, userId: string): Promise<Journey> {
    const journey = await this.findById(journeyId);

    if (journey.leaderId !== userId) {
      throw new ForbiddenException('Only leader can end journey');
    }

    if (journey.status !== 'ACTIVE') {
      throw new BadRequestException('Journey is not active');
    }

    await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .update({
        status: 'COMPLETED',
        endTime: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    // Remove from active journeys in Redis
    await this.redisService.removeActiveJourney(journeyId);

    return this.findById(journeyId);
  }

  async inviteParticipant(
    journeyId: string,
    userId: string,
    invitedUserId: string,
  ): Promise<void> {
    const journey = await this.findById(journeyId);

    if (journey.leaderId !== userId) {
      throw new ForbiddenException('Only leader can invite participants');
    }

    if (journey.status !== 'PENDING') {
      throw new BadRequestException('Can only invite to pending journeys');
    }

    // Check for self-invitation
    if (userId === invitedUserId) {
      throw new BadRequestException('Cannot invite yourself to a journey');
    }

    // Check if invited user exists
    const invitedUserDoc = await this.firebaseService.firestore
      .collection('users')
      .doc(invitedUserId)
      .get();

    if (!invitedUserDoc.exists) {
      throw new NotFoundException('Invited user not found');
    }

    // Check if user is already invited or participating
    const existingParticipant = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .doc(invitedUserId)
      .get();

    if (existingParticipant.exists) {
      const status = existingParticipant.data()?.status;
      if (status === 'INVITED') {
        throw new BadRequestException('User already invited to this journey');
      }
      if (['ACTIVE', 'ACCEPTED'].includes(status)) {
        throw new BadRequestException('User is already participating in this journey');
      }
      // If status is DECLINED or LEFT, allow re-invitation (will overwrite)
    }

    // Add participant with INVITED status
    await this.participantService.addParticipant(journeyId, invitedUserId, userId);

    // Create notification for the invited user
    await this.createInvitationNotification(journeyId, invitedUserId, userId, journey.name);
  }

  async getUserPendingInvitations(userId: string): Promise<any[]> {
    // Get all participant records where user is invited
    const snapshot = await this.firebaseService.firestore
      .collectionGroup('participants')
      .where('userId', '==', userId)
      .where('status', '==', 'INVITED')
      .get();

    const invitations: any[] = [];

    for (const doc of snapshot.docs) {
      const journeyId = doc.ref.parent.parent?.id;
      if (journeyId) {
        try {
          const journey = await this.findById(journeyId);

          // Get inviter details
          const inviterDoc = await this.firebaseService.firestore
            .collection('users')
            .doc(doc.data().invitedBy)
            .get();

          invitations.push({
            journeyId: journey.id,
            journeyName: journey.name,
            destination: journey.destinationAddress,
            invitedBy: {
              uid: doc.data().invitedBy,
              displayName: inviterDoc.data()?.displayName || 'Unknown',
              email: inviterDoc.data()?.email || '',
            },
            invitedAt: doc.data().createdAt || new Date().toISOString(),
          });
        } catch (error) {
          // Only skip if journey was deleted (NotFoundException expected)
          if (error instanceof NotFoundException) {
            continue;
          }
          // Log other errors but continue processing remaining invitations
          console.error(`Error fetching journey ${journeyId} for invitation:`, error);
          continue;
        }
      }
    }

    return invitations;
  }

  private async createInvitationNotification(
    journeyId: string,
    invitedUserId: string,
    inviterId: string,
    journeyName: string,
  ): Promise<void> {
    // Get inviter details
    const inviterDoc = await this.firebaseService.firestore
      .collection('users')
      .doc(inviterId)
      .get();

    const inviterName = inviterDoc.data()?.displayName || 'Someone';

    // Create notification document
    await this.firebaseService.firestore
      .collection('notifications')
      .add({
        userId: invitedUserId,
        type: 'JOURNEY_INVITATION',
        title: 'Journey Invitation',
        message: `${inviterName} invited you to join "${journeyName}"`,
        data: {
          journeyId,
          inviterId,
          journeyName,
        },
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
  }

  async getUserActiveJourneys(userId: string): Promise<Journey[]> {
    const snapshot = await this.firebaseService.firestore
      .collectionGroup('participants')
      .where('userId', '==', userId)
      .where('status', 'in', ['ACTIVE', 'ACCEPTED'])
      .get();

    const journeyIds = new Set(
      snapshot.docs
        .map((doc) => doc.ref.parent.parent?.id)
        .filter((id): id is string => id !== undefined),
    );
    const journeys: Journey[] = [];

    for (const journeyId of journeyIds) {
      const journey = await this.findById(journeyId);
      if (journey.status === 'ACTIVE') {
        journeys.push(journey);
      }
    }

    return journeys;
  }

  async getUserJourneyHistory(userId: string): Promise<Journey[]> {
    const snapshot = await this.firebaseService.firestore
      .collectionGroup('participants')
      .where('userId', '==', userId)
      .get();

    const journeyIds = new Set(
      snapshot.docs
        .map((doc) => doc.ref.parent.parent?.id)
        .filter((id): id is string => id !== undefined),
    );
    const journeys: Journey[] = [];

    for (const journeyId of journeyIds) {
      try {
        const journey = await this.findById(journeyId);
        if (journey.status === 'COMPLETED') {
          journeys.push(journey);
        }
      } catch (error) {
        // Skip journeys that no longer exist
        continue;
      }
    }

    // Sort by endTime (most recent first)
    return journeys.sort((a, b) => {
      const aTime = a.endTime
        ? typeof a.endTime === 'string'
          ? new Date(a.endTime).getTime()
          : a.endTime.toDate().getTime()
        : 0;
      const bTime = b.endTime
        ? typeof b.endTime === 'string'
          ? new Date(b.endTime).getTime()
          : b.endTime.toDate().getTime()
        : 0;
      return bTime - aTime;
    });
  }

  async getJourneyWithParticipants(journeyId: string, userId: string) {
    const journey = await this.findById(journeyId);
    const isParticipant = await this.participantService.isParticipant(journeyId, userId);

    if (!isParticipant) {
      throw new ForbiddenException('Not a participant of this journey');
    }

    const participants = await this.participantService.getJourneyParticipants(journeyId);

    return {
      ...journey,
      participants,
    };
  }
}
