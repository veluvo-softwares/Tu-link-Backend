import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../shared/redis/redis.service';
import { DatabaseService } from '../../database/database.service';
import { JourneyRepository } from '../../database/repositories/journey.repository';
import { UsersRepository } from '../../database/repositories/users.repository';
import { ParticipantService } from './services/participant.service';
import { NotificationService } from '../notification/notification.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { LocationGateway } from '../location/location.gateway';
import { CreateJourneyDto } from './dto/create-journey.dto';
import { UpdateJourneyDto } from './dto/update-journey.dto';
import { Journey } from '../../shared/interfaces/journey.interface';
import { LoggerService } from '../../shared/logger/logger.service';

@Injectable()
export class JourneyService {
  constructor(
    private journeyRepository: JourneyRepository,
    private usersRepository: UsersRepository,
    private redisService: RedisService,
    private databaseService: DatabaseService,
    private participantService: ParticipantService,
    private notificationService: NotificationService,
    private configService: ConfigService,
    private analyticsService: AnalyticsService,
    @Inject(forwardRef(() => LocationGateway))
    private locationGateway: LocationGateway,
    private logger: LoggerService,
  ) {}

  /**
   * Validate a client-supplied schedule instant. Bounds keep the scheduler
   * scan meaningful: far enough out that reminders make sense, near enough
   * that a PENDING row doesn't squat the one-open-per-leader slot for months.
   */
  private parseScheduledFor(scheduledFor: string): Date {
    const when = new Date(scheduledFor);
    const minMs = Date.now() + 5 * 60 * 1000;
    const maxMs = Date.now() + 60 * 24 * 60 * 60 * 1000;
    if (Number.isNaN(when.getTime()) || when.getTime() < minMs) {
      throw new BadRequestException(
        'scheduledFor must be at least 5 minutes in the future',
      );
    }
    if (when.getTime() > maxMs) {
      throw new BadRequestException('scheduledFor must be within 60 days');
    }
    return when;
  }

  async create(
    userId: string,
    createJourneyDto: CreateJourneyDto,
  ): Promise<Journey> {
    await this.assertNoOtherOpenJourney(userId);

    const scheduledFor = createJourneyDto.scheduledFor
      ? this.parseScheduledFor(createJourneyDto.scheduledFor)
      : undefined;

    let journey: Awaited<ReturnType<JourneyRepository['create']>> | null = null;
    for (let attempt = 0; attempt < 5 && journey == null; attempt++) {
      try {
        journey = await this.journeyRepository.create({
          inviteCode: this.generateInviteCode(),
          name: createJourneyDto.name,
          leaderId: userId,
          destination: createJourneyDto.destination,
          destinationAddress: createJourneyDto.destinationAddress,
          lagThresholdMeters:
            createJourneyDto.lagThresholdMeters ||
            this.configService.get<number>('app.defaultLagThresholdMeters') ||
            500,
          scheduledFor,
          metadata:
            scheduledFor && createJourneyDto.autoStart
              ? { autoStart: true }
              : undefined,
        });
      } catch (error) {
        if (this.isInviteCodeViolation(error) && attempt < 4) continue;
        if (this.isUniqueViolation(error)) throw this.openJourneyConflict();
        throw error;
      }
    }
    if (journey == null) {
      throw new ConflictException('Could not allocate a journey code');
    }

    // Add creator as leader participant
    try {
      await this.participantService.addParticipant(
        journey.id,
        userId,
        userId,
        'LEADER',
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        await this.journeyRepository.updateStatus(journey.id, 'CANCELLED', {
          setEndTime: true,
        });
        throw this.openJourneyConflict();
      }
      throw error;
    }

    return journey as unknown as Journey;
  }

  async findById(journeyId: string): Promise<Journey> {
    const journey = await this.journeyRepository.findById(journeyId);

    if (!journey) {
      throw new NotFoundException('Journey not found');
    }

    return journey as unknown as Journey;
  }

  /**
   * Orchestrate a participant leaving a journey.
   * Fetches participants with displayNames BEFORE the DB leave (while the actor
   * is still in the list), resolves recipients, commits the leave, then fires
   * a best-effort PARTICIPANT_LEFT notification (NOTIF-07, D-12).
   */
  async leaveJourney(journeyId: string, userId: string): Promise<void> {
    const journey = await this.findById(journeyId);
    if (journey.status !== 'PENDING' && journey.status !== 'ACTIVE') {
      throw new BadRequestException('This journey can no longer be left');
    }

    // a. Fetch participants with displayNames BEFORE the leave so the actor is
    //    still present and their displayName can be resolved (RESEARCH.md Pitfall 5).
    const participants =
      await this.participantService.getJourneyParticipants(journeyId);

    // b. Resolve the leaving participant's display name.
    const leavingParticipant = participants.find((p) => p.userId === userId);
    const leavingParticipantName =
      leavingParticipant?.displayName ?? 'A participant';

    // c. Resolve notification recipients before the leave (actor still in list,
    //    resolveParticipantRecipients will exclude them per D-01).
    const recipientIds = this.notificationService.resolveParticipantRecipients(
      participants,
      userId,
    );

    // d. Commit the critical user action — must succeed before any notification.
    await this.participantService.leaveJourney(journeyId, userId);

    // e. Best-effort notification — mirrors start() post-commit block (D-12).
    try {
      await this.notificationService.sendParticipantLeft(
        journeyId,
        journey.name,
        leavingParticipantName,
        userId,
        recipientIds,
      );
    } catch (err) {
      this.logger.error(
        'Post-leave notification failed for journey ' + journeyId,
        err instanceof Error ? err.stack : undefined,
        'JourneyService',
        { journeyId, userId },
      );
      // Do NOT rethrow — the leave is already committed.
    }
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

    let metadata: Journey['metadata'] | undefined;
    let scheduledFor: Date | undefined;
    if (updateJourneyDto.scheduledFor !== undefined) {
      scheduledFor = this.parseScheduledFor(updateJourneyDto.scheduledFor);
      // Rescheduling restarts the reminder ladder for the new instant.
      metadata = { ...journey.metadata, remindersSent: [] };
    }
    if (updateJourneyDto.autoStart !== undefined) {
      metadata = {
        ...(metadata ?? journey.metadata),
        autoStart: updateJourneyDto.autoStart,
      };
    }

    await this.journeyRepository.update(journeyId, {
      name: updateJourneyDto.name,
      destination: updateJourneyDto.destination,
      destinationAddress: updateJourneyDto.destinationAddress,
      lagThresholdMeters: updateJourneyDto.lagThresholdMeters,
      scheduledFor,
      metadata,
    });

    return this.findById(journeyId);
  }

  async delete(journeyId: string, userId: string): Promise<void> {
    const journey = await this.findById(journeyId);

    if (journey.leaderId !== userId) {
      throw new ForbiddenException('Only leader can delete journey');
    }

    if (journey.status !== 'PENDING') {
      throw new BadRequestException('Only pending journeys can be cancelled');
    }

    const participants =
      await this.participantService.getJourneyParticipants(journeyId);
    const recipientIds = participants
      .filter(
        (participant) =>
          participant.userId !== userId &&
          ['INVITED', 'ACCEPTED', 'ACTIVE', 'ARRIVED'].includes(
            participant.status,
          ),
      )
      .map((participant) => participant.userId);

    await this.journeyRepository.updateStatus(journeyId, 'CANCELLED', {
      setEndTime: true,
    });
    await this.participantService.releaseJoinedMemberships(journeyId);

    try {
      await Promise.all([
        this.notificationService.sendJourneyCancelled(
          journeyId,
          journey.name,
          recipientIds,
        ),
        this.locationGateway.broadcastJourneyEnded(journeyId, {
          ...journey,
          status: 'CANCELLED',
          participants,
        }),
      ]);
    } catch (error) {
      this.logger.error(
        `Post-cancellation feedback failed for journey ${journeyId}`,
        error instanceof Error ? error.stack : undefined,
        'JourneyService',
        { journeyId, leaderId: userId },
      );
    }

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

    try {
      await this.databaseService.db.transaction(async (tx) => {
        const activeJourney = await this.journeyRepository.findActiveByLeader(
          tx,
          journey.leaderId,
        );

        if (activeJourney && activeJourney.id !== journeyId) {
          throw new ConflictException({
            message: 'You already have an active journey',
            error: 'ALREADY_IN_ACTIVE_JOURNEY',
            activeJourneyId: activeJourney.id,
          });
        }

        await this.journeyRepository.updateStatus(
          journeyId,
          'ACTIVE',
          { setStartTime: true },
          tx,
        );
      });
    } catch (error) {
      // Drizzle's node-postgres driver wraps the raw pg error in a
      // DrizzleQueryError, so the Postgres error code lives on `.cause`, not
      // directly on the thrown error. A 23505 here is the rare concurrent
      // race where both requests passed the pre-check. Postgres aborts the
      // whole transaction on this error (25P02 on any further command in the
      // same tx), so the re-query for activeJourneyId MUST run after the
      // transaction has rolled back, using the regular (non-tx) db handle —
      // querying via `tx` here would itself fail with 25P02.
      const pgCode =
        (error as { code?: string }).code ??
        (error as { cause?: { code?: string } }).cause?.code;
      if (pgCode === '23505') {
        const conflicting = await this.journeyRepository.findActiveByLeader(
          this.databaseService.db,
          journey.leaderId,
        );
        if (!conflicting) {
          // The competing transaction's ACTIVE journey resolved (e.g. ended)
          // in the window between our 23505 and this re-query. We still lost
          // the race for this journeyId (the unique-violation proves another
          // write won), but there is no longer a real activeJourneyId to
          // report -- omitting it would silently degrade the {code,
          // activeJourneyId} contract. Log the anomaly and surface a 409
          // without a stale/undefined id so the client can safely retry.
          this.logger.warn(
            `23505 on journey ${journeyId} but no ACTIVE journey found on re-query for leader ${journey.leaderId}`,
            'JourneyService',
          );
          throw new ConflictException({
            message:
              'You already have an active journey, please retry starting this journey',
            error: 'ALREADY_IN_ACTIVE_JOURNEY',
          });
        }
        throw new ConflictException({
          message: 'You already have an active journey',
          error: 'ALREADY_IN_ACTIVE_JOURNEY',
          activeJourneyId: conflicting.id,
        });
      }
      throw error;
    }

    // The journey is now durably ACTIVE in Postgres. Everything below is a
    // post-commit side effect (participant activation, Redis registration,
    // notifications, WS broadcast) -- it must never leak a raw 500 back to
    // the caller nor silently swallow the resulting drift, since the DB
    // write has already succeeded. Failures here are logged best-effort and
    // the now-ACTIVE journey is still returned.
    try {
      // Capture who is being activated BEFORE the bulk update (the filter
      // below keys off the pre-activation ACCEPTED/LEADER state for Redis +
      // notifications).
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
    } catch (err) {
      // The journey row is already committed ACTIVE -- log loudly so the
      // Redis/notification drift is observable, but do not fail the request:
      // the start itself succeeded.
      this.logger.error(
        `Post-start side effects failed for journey ${journeyId}`,
        err instanceof Error ? err.stack : undefined,
        'JourneyService',
        { journeyId, leaderId: journey.leaderId },
      );
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

    await this.participantService.releaseJoinedMemberships(journeyId);

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

    const invitation = await this.participantService.getParticipant(
      journeyId,
      userId,
    );
    if (!invitation || invitation.status !== 'INVITED') {
      throw new NotFoundException('Invitation not found');
    }

    // Can't join a journey that has already ended or been cancelled.
    if (journey.status === 'COMPLETED' || journey.status === 'CANCELLED') {
      throw new BadRequestException(
        'This journey is no longer accepting participants',
      );
    }

    await this.assertNoOtherOpenJourney(userId, journeyId);

    try {
      if (journey.status === 'ACTIVE') {
        // Journey already started — promote directly to ACTIVE so the user can
        // immediately join the WebSocket room and send location updates.
        await this.participantService.markActive(journeyId, userId);

        // Add to the Redis participants set so they appear in live snapshot queries.
        await this.redisService.addJourneyParticipant(journeyId, userId);
      } else {
        await this.participantService.acceptInvitation(journeyId, userId);
      }
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.openJourneyConflict();
      }
      throw error;
    }

    const user = await this.usersRepository.findById(userId);
    const displayName = user?.displayName || 'Unknown';

    // Fire-and-forget so accepting is not blocked on the room-membership
    // logging inside the broadcast; log rejections instead of discarding them.
    this.locationGateway
      .broadcastParticipantAccepted(journeyId, {
        userId,
        displayName,
        status: journey.status === 'ACTIVE' ? 'ACTIVE' : 'ACCEPTED',
      })
      .catch((err: Error) =>
        console.error(
          `broadcastParticipantAccepted failed for journey ${journeyId}, user ${userId}: ${err.message}`,
        ),
      );

    // Best-effort PARTICIPANT_JOINED notification for existing members (NOTIF-09, D-01/D-12).
    try {
      const participants =
        await this.participantService.getJourneyParticipants(journeyId);
      const recipientIds =
        this.notificationService.resolveParticipantRecipients(
          participants,
          userId,
        );
      await this.notificationService.sendParticipantJoined(
        journeyId,
        journey.name,
        displayName,
        recipientIds,
      );
    } catch (err) {
      this.logger.error(
        'Post-accept notification failed for journey ' + journeyId,
        err instanceof Error ? err.stack : undefined,
        'JourneyService',
        { journeyId, userId },
      );
      // Do NOT rethrow — the accept is already committed.
    }
  }

  async joinWithCode(inviteCode: string, userId: string) {
    const normalizedCode = inviteCode.trim().toUpperCase();
    const journey =
      await this.journeyRepository.findByInviteCode(normalizedCode);
    if (!journey) throw new NotFoundException('Journey code not found');
    if (journey.status !== 'PENDING' && journey.status !== 'ACTIVE') {
      throw new BadRequestException(
        'This journey is no longer accepting participants',
      );
    }

    const existing = await this.participantService.getParticipant(
      journey.id,
      userId,
    );
    if (
      existing?.role === 'LEADER' ||
      (existing && ['ACCEPTED', 'ACTIVE', 'ARRIVED'].includes(existing.status))
    ) {
      return this.getJourneyWithParticipants(journey.id, userId);
    }

    await this.assertNoOtherOpenJourney(userId, journey.id);
    const joinedStatus = journey.status === 'ACTIVE' ? 'ACTIVE' : 'ACCEPTED';
    try {
      await this.participantService.joinWithCode(
        journey.id,
        userId,
        journey.leaderId,
        joinedStatus,
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) throw this.openJourneyConflict();
      throw error;
    }

    if (journey.status === 'ACTIVE') {
      try {
        await this.redisService.addJourneyParticipant(journey.id, userId);
      } catch (error) {
        // The database admission is already committed. Do not report a failed
        // join and tempt the client to retry just because the live cache is
        // temporarily unavailable; socket/location activity can repopulate it.
        this.logger.error(
          `Post-code-join Redis sync failed for journey ${journey.id}`,
          error instanceof Error ? error.stack : undefined,
          'JourneyService',
          { journeyId: journey.id, userId },
        );
      }
    }

    const user = await this.usersRepository.findById(userId);
    const displayName = user?.displayName || 'Unknown';
    this.locationGateway
      .broadcastParticipantAccepted(journey.id, {
        userId,
        displayName,
        status: joinedStatus,
      })
      .catch((err: Error) =>
        this.logger.error(
          `Code-join broadcast failed for journey ${journey.id}`,
          err.stack,
          'JourneyService',
          { journeyId: journey.id, userId },
        ),
      );

    try {
      const participants = await this.participantService.getJourneyParticipants(
        journey.id,
      );
      const recipientIds =
        this.notificationService.resolveParticipantRecipients(
          participants,
          userId,
        );
      await this.notificationService.sendParticipantJoined(
        journey.id,
        journey.name,
        displayName,
        recipientIds,
      );
    } catch (error) {
      this.logger.error(
        `Post-code-join notification failed for journey ${journey.id}`,
        error instanceof Error ? error.stack : undefined,
        'JourneyService',
        { journeyId: journey.id, userId },
      );
    }

    return this.getJourneyWithParticipants(journey.id, userId);
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
      ['ACTIVE', 'ACCEPTED', 'ARRIVED'],
    );

    const journeyIds = new Set(participations.map((p) => p.journeyId));
    const journeys: Journey[] = [];

    for (const journeyId of journeyIds) {
      const journey = await this.findById(journeyId);
      if (journey.status === 'PENDING' || journey.status === 'ACTIVE') {
        journeys.push(journey);
      }
    }

    return journeys;
  }

  private async assertNoOtherOpenJourney(
    userId: string,
    excludedJourneyId?: string,
  ): Promise<void> {
    const openJourneys = await this.getUserActiveJourneys(userId);
    const conflict = openJourneys.find(
      (journey) => journey.id !== excludedJourneyId,
    );
    if (conflict) {
      throw this.openJourneyConflict(conflict.id, conflict.status);
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      (error as { code?: string }).code === '23505' ||
      (error as { cause?: { code?: string } }).cause?.code === '23505'
    );
  }

  private isInviteCodeViolation(error: unknown): boolean {
    const constraint =
      (error as { constraint?: string }).constraint ??
      (error as { cause?: { constraint?: string } }).cause?.constraint;
    return constraint === 'idx_journeys_invite_code';
  }

  private generateInviteCode(): string {
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    return Array.from(
      { length: 10 },
      () => alphabet[randomInt(alphabet.length)],
    ).join('');
  }

  private openJourneyConflict(
    journeyId?: string,
    journeyStatus?: string,
  ): ConflictException {
    return new ConflictException({
      message: 'You are already in another journey',
      error: 'ALREADY_IN_JOURNEY',
      ...(journeyId ? { journeyId } : {}),
      ...(journeyStatus ? { journeyStatus } : {}),
    });
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
