import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../shared/redis/redis.service';
import { JourneyRepository } from '../../database/repositories/journey.repository';
import { UsersRepository } from '../../database/repositories/users.repository';
import { ParticipantService } from './services/participant.service';
import { NotificationService } from '../notification/notification.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { LocationGateway } from '../location/location.gateway';
import { CreateJourneyDto } from './dto/create-journey.dto';
import { UpdateJourneyDto } from './dto/update-journey.dto';
import { Journey } from '../../shared/interfaces/journey.interface';

@Injectable()
export class JourneyService {
  constructor(
    private journeyRepository: JourneyRepository,
    private usersRepository: UsersRepository,
    private redisService: RedisService,
    private participantService: ParticipantService,
    private notificationService: NotificationService,
    private configService: ConfigService,
    private analyticsService: AnalyticsService,
    @Inject(forwardRef(() => LocationGateway))
    private locationGateway: LocationGateway,
  ) {}

  async create(
    userId: string,
    createJourneyDto: CreateJourneyDto,
  ): Promise<Journey> {
    const journey = await this.journeyRepository.create({
      name: createJourneyDto.name,
      leaderId: userId,
      destination: createJourneyDto.destination,
      destinationAddress: createJourneyDto.destinationAddress,
      lagThresholdMeters:
        createJourneyDto.lagThresholdMeters ||
        this.configService.get<number>('app.defaultLagThresholdMeters') ||
        500,
    });

    // Add creator as leader participant
    await this.participantService.addParticipant(
      journey.id,
      userId,
      userId,
      'LEADER',
    );

    return journey as unknown as Journey;
  }

  async findById(journeyId: string): Promise<Journey> {
    const journey = await this.journeyRepository.findById(journeyId);

    if (!journey) {
      throw new NotFoundException('Journey not found');
    }

    return journey as unknown as Journey;
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

    await this.journeyRepository.update(journeyId, {
      name: updateJourneyDto.name,
      destination: updateJourneyDto.destination,
      destinationAddress: updateJourneyDto.destinationAddress,
      lagThresholdMeters: updateJourneyDto.lagThresholdMeters,
    });

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

    await this.journeyRepository.updateStatus(journeyId, 'CANCELLED', {
      setEndTime: true,
    });

    // Clean up all Redis keys for this journey
    // Participant keys must be cleared before clearJourneyCache() removes the
    // participant set, so read the set first.
    const participantIds =
      await this.redisService.getJourneyParticipants(journeyId);

    await this.redisService.clearJourneyCache(journeyId);

    // Clear per-participant connection state
    const redisClient = this.redisService.getClient();
    for (const participantId of participantIds) {
      await redisClient.del(
        `participant:${participantId}:connected`,
        `participant:${participantId}:lastHeartbeat`,
        `participant:${participantId}:socketId`,
        `participant:${participantId}:lastSeq`,
      );
    }

    // Clear WebSocket room key
    await redisClient.del(`ws:room:${journeyId}`);

    // Clear journey metrics cache
    await redisClient.del(`journey_metrics:${journeyId}`);

    console.log(`✅ Redis keys cleared for journey ${journeyId}`);
  }

  async start(journeyId: string, userId: string): Promise<Journey> {
    const journey = await this.findById(journeyId);

    if (journey.leaderId !== userId) {
      throw new ForbiddenException('Only leader can start journey');
    }

    if (journey.status !== 'PENDING') {
      throw new BadRequestException('Journey already started or completed');
    }

    await this.journeyRepository.updateStatus(journeyId, 'ACTIVE', {
      setStartTime: true,
    });

    // Capture who is being activated BEFORE the bulk update (the filter below
    // keys off the pre-activation ACCEPTED/LEADER state for Redis + notifications).
    const participants =
      await this.participantService.getJourneyParticipants(journeyId);

    // Promote all accepted participants (and the leader) to ACTIVE in one query
    await this.participantService.activateForStart(journeyId);

    // Add to active journeys in Redis
    await this.redisService.addActiveJourney(journeyId);

    // Cache participants in Redis
    const activeParticipants = participants.filter(
      (p) => p.status === 'ACCEPTED' || p.role === 'LEADER',
    );
    for (const participant of activeParticipants) {
      await this.redisService.addJourneyParticipant(
        journeyId,
        participant.userId,
      );
    }

    // Send journey started notifications to all active participants
    const participantIds = activeParticipants.map((p) => p.userId);
    await this.notificationService.sendJourneyStarted(
      journeyId,
      journey.name,
      participantIds,
    );

    // Broadcast to all members in the WebSocket room so members on the home
    // screen can navigate to the map without waiting for an FCM notification.
    await this.locationGateway.broadcastJourneyStarted(journeyId, {
      journeyId,
      journeyName: journey.name,
      status: 'ACTIVE',
    });

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

    return this.completeJourney(journeyId);
  }

  /**
   * Called automatically when all participants have arrived at the destination.
   * Skips the leader/status guards since arrival detection already verified state.
   */
  async autoCompleteJourney(journeyId: string): Promise<Journey> {
    const journey = await this.findById(journeyId);

    // Guard: only act on still-active journeys (avoids double-complete race)
    if (journey.status !== 'ACTIVE') {
      return journey;
    }

    return this.completeJourney(journeyId);
  }

  private async completeJourney(journeyId: string): Promise<Journey> {
    await this.journeyRepository.updateStatus(journeyId, 'COMPLETED', {
      setEndTime: true,
    });

    // Calculate and store analytics — fire-and-forget, do not block end()
    this.analyticsService
      .calculateJourneyAnalytics(journeyId)
      .catch((err: Error) =>
        console.error(
          `Analytics calculation failed for journey ${journeyId}: ${err.message}`,
        ),
      );

    await this.redisService.removeActiveJourney(journeyId);

    const cachedParticipantIds =
      await this.redisService.getJourneyParticipants(journeyId);

    await this.redisService.clearJourneyCache(journeyId);

    const redisClient = this.redisService.getClient();
    for (const participantId of cachedParticipantIds) {
      await redisClient.del(
        `participant:${participantId}:connected`,
        `participant:${participantId}:lastHeartbeat`,
        `participant:${participantId}:socketId`,
        `participant:${participantId}:lastSeq`,
      );
    }

    await redisClient.del(`ws:room:${journeyId}`);
    await redisClient.del(`journey_metrics:${journeyId}`);

    console.log(`✅ Redis keys cleared for journey ${journeyId}`);

    const participants =
      await this.participantService.getJourneyParticipants(journeyId);
    const notifyIds = participants
      .filter(
        (p) =>
          p.status === 'ACTIVE' ||
          p.status === 'ARRIVED' ||
          p.role === 'LEADER',
      )
      .map((p) => p.userId);

    const journey = await this.findById(journeyId);

    await this.notificationService.sendJourneyEnded(
      journeyId,
      journey.name,
      notifyIds,
    );

    const journeyWithParticipants = { ...journey, participants };
    await this.locationGateway.broadcastJourneyEnded(
      journeyId,
      journeyWithParticipants,
    );

    return journeyWithParticipants;
  }

  async acceptInvitation(journeyId: string, userId: string): Promise<void> {
    const journey = await this.findById(journeyId);

    // Can't join a journey that has already ended or been cancelled.
    if (journey.status === 'COMPLETED' || journey.status === 'CANCELLED') {
      throw new BadRequestException(
        'This journey is no longer accepting participants',
      );
    }

    if (journey.status === 'ACTIVE') {
      // Journey already started — promote directly to ACTIVE so the user can
      // immediately join the WebSocket room and send location updates.
      await this.participantService.markActive(journeyId, userId);

      // Add to the Redis participants set so they appear in live snapshot queries.
      await this.redisService.addJourneyParticipant(journeyId, userId);
    } else {
      await this.participantService.acceptInvitation(journeyId, userId);
    }

    const user = await this.usersRepository.findById(userId);
    const displayName = user?.displayName || 'Unknown';

    this.locationGateway.broadcastParticipantAccepted(journeyId, {
      userId,
      displayName,
      status: journey.status === 'ACTIVE' ? 'ACTIVE' : 'ACCEPTED',
    });
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
    const invitedUser = await this.usersRepository.findById(invitedUserId);

    if (!invitedUser) {
      throw new NotFoundException('Invited user not found');
    }

    // Check if user is already invited or participating
    const existingParticipant = await this.participantService.getParticipant(
      journeyId,
      invitedUserId,
    );

    if (existingParticipant) {
      const status = existingParticipant.status;
      if (status === 'INVITED') {
        throw new BadRequestException('User already invited to this journey');
      }
      if (['ACTIVE', 'ACCEPTED'].includes(status)) {
        throw new BadRequestException(
          'User is already participating in this journey',
        );
      }
      // If status is DECLINED or LEFT, allow re-invitation (will overwrite)
    }

    // Add participant with INVITED status
    await this.participantService.addParticipant(
      journeyId,
      invitedUserId,
      userId,
    );

    // Create notification for the invited user (persists + FCM push)
    await this.createInvitationNotification(
      journeyId,
      invitedUserId,
      userId,
      journey.name,
    );

    // Real-time WS push to the invited user's connected sockets so their invite
    // list updates live without a reload. FCM (above) covers the offline case.
    this.locationGateway.broadcastJourneyInvite(invitedUserId, {
      journeyId,
      journeyName: journey.name,
      invitedBy: userId,
      timestamp: Date.now(),
    });
  }

  async getUserPendingInvitations(userId: string): Promise<any[]> {
    // Participant rows where this user is invited (replaces collectionGroup).
    const pending = await this.participantService.getUserParticipations(
      userId,
      ['INVITED'],
    );

    const invitations: any[] = [];

    for (const participant of pending) {
      const journeyId = participant.journeyId;
      try {
        const journey = await this.findById(journeyId);

        // Don't surface invitations for journeys that have ended or been
        // cancelled — they can't be accepted.
        if (journey.status === 'COMPLETED' || journey.status === 'CANCELLED') {
          continue;
        }

        // Get inviter details
        const inviter = participant.invitedBy
          ? await this.usersRepository.findById(participant.invitedBy)
          : null;

        invitations.push({
          journeyId: journey.id,
          journeyName: journey.name,
          destination: journey.destinationAddress,
          invitedBy: {
            uid: participant.invitedBy,
            displayName: inviter?.displayName || 'Unknown',
            email: inviter?.email || '',
          },
          invitedAt: new Date().toISOString(),
        });
      } catch (error) {
        // Only skip if journey was deleted (NotFoundException expected)
        if (error instanceof NotFoundException) {
          continue;
        }
        // Log other errors but continue processing remaining invitations
        console.error(
          `Error fetching journey ${journeyId} for invitation:`,
          error,
        );
        continue;
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
    const inviter = await this.usersRepository.findById(inviterId);
    const inviterName = inviter?.displayName || 'Someone';

    // Send invitation notification with FCM push notification
    await this.notificationService.sendJourneyInvite(
      journeyId,
      journeyName,
      invitedUserId,
      inviterName,
    );
  }

  async getUserActiveJourneys(userId: string): Promise<Journey[]> {
    const participations = await this.participantService.getUserParticipations(
      userId,
      ['ACTIVE', 'ACCEPTED'],
    );

    const journeyIds = new Set(participations.map((p) => p.journeyId));
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
    const participations =
      await this.participantService.getUserParticipations(userId);

    const journeyIds = new Set(participations.map((p) => p.journeyId));
    const journeys: Journey[] = [];

    for (const journeyId of journeyIds) {
      try {
        const journey = await this.findById(journeyId);
        if (journey.status === 'COMPLETED') {
          journeys.push(journey);
        }
      } catch {
        // Skip journeys that no longer exist
        continue;
      }
    }

    // Sort by endTime (most recent first). endTime is a Date from Postgres,
    // but tolerate string/Firestore-Timestamp shapes defensively.
    const toMillis = (value: unknown): number => {
      if (!value) return 0;
      if (value instanceof Date) return value.getTime();
      if (typeof value === 'string') return new Date(value).getTime();
      if (
        typeof value === 'object' &&
        typeof (value as { toDate?: () => Date }).toDate === 'function'
      ) {
        return (value as { toDate: () => Date }).toDate().getTime();
      }
      return 0;
    };

    return journeys.sort((a, b) => toMillis(b.endTime) - toMillis(a.endTime));
  }

  async getJourneyWithParticipants(journeyId: string, userId: string) {
    const journey = await this.findById(journeyId);
    const isParticipant = await this.participantService.isParticipant(
      journeyId,
      userId,
    );

    if (!isParticipant) {
      throw new ForbiddenException('Not a participant of this journey');
    }

    const participants =
      await this.participantService.getJourneyParticipants(journeyId);

    return {
      ...journey,
      participants,
    };
  }
}
