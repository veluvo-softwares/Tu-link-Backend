import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FcmService } from './services/fcm.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { Notification } from '../../shared/interfaces/notification.interface';
import { NotificationRepository } from '../../database/repositories/notification.repository';
import { FcmTokenRepository } from '../../database/repositories/fcm-token.repository';
import { UsersRepository } from '../../database/repositories/users.repository';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private notificationRepository: NotificationRepository,
    private fcmTokenRepository: FcmTokenRepository,
    private usersRepository: UsersRepository,
    private fcmService: FcmService,
  ) {}

  /**
   * Create and send a notification
   */
  async createNotification(
    createNotificationDto: CreateNotificationDto,
  ): Promise<Notification> {
    const notification = await this.notificationRepository.create({
      journeyId: createNotificationDto.journeyId,
      recipientId: createNotificationDto.recipientId,
      type: createNotificationDto.type,
      title: createNotificationDto.title,
      body: createNotificationDto.body,
      data: createNotificationDto.data,
    });

    // Send FCM push notification
    const userTokens = await this.getUserFcmTokens(
      createNotificationDto.recipientId,
    );
    await this.fcmService.sendToUser(userTokens, {
      title: createNotificationDto.title,
      body: createNotificationDto.body,
      data: this.convertDataToStringRecord(createNotificationDto.data),
    });

    return notification as unknown as Notification;
  }

  /**
   * Send journey invite notification
   */
  async sendJourneyInvite(
    journeyId: string,
    journeyName: string,
    recipientId: string,
    inviterName: string,
  ): Promise<void> {
    await this.createNotification({
      journeyId,
      recipientId,
      type: 'JOURNEY_INVITE',
      title: 'Journey Invitation',
      body: `${inviterName} invited you to join "${journeyName}"`,
      data: { journeyId, journeyName, inviterName },
    });
  }

  /**
   * Send journey started notification
   */
  async sendJourneyStarted(
    journeyId: string,
    journeyName: string,
    recipientIds: string[],
  ): Promise<void> {
    const notifications = recipientIds.map((recipientId) =>
      this.createNotification({
        journeyId,
        recipientId,
        type: 'JOURNEY_STARTED',
        title: 'Journey Started',
        body: `The journey "${journeyName}" has begun!`,
        data: { journeyId, journeyName },
      }),
    );

    await Promise.all(notifications);
  }

  /**
   * Send journey ended notification
   */
  async sendJourneyEnded(
    journeyId: string,
    journeyName: string,
    recipientIds: string[],
  ): Promise<void> {
    const notifications = recipientIds.map((recipientId) =>
      this.createNotification({
        journeyId,
        recipientId,
        type: 'JOURNEY_ENDED',
        title: 'Journey Completed',
        body: `The journey "${journeyName}" has ended`,
        data: { journeyId, journeyName },
      }),
    );

    await Promise.all(notifications);
  }

  /**
   * Send lag alert notification
   */
  async sendLagAlert(
    journeyId: string,
    userId: string,
    distance: number,
    severity: 'WARNING' | 'CRITICAL',
  ): Promise<void> {
    const title =
      severity === 'CRITICAL' ? 'Critical Lag Alert' : 'Lag Warning';
    const body = `You are ${Math.round(distance)}m behind the leader`;

    await this.createNotification({
      journeyId,
      recipientId: userId,
      type: 'LAG_ALERT',
      title,
      body,
      data: { distance: distance.toString(), severity },
    });
  }

  /**
   * Send participant joined notification
   */
  async sendParticipantJoined(
    journeyId: string,
    journeyName: string,
    participantName: string,
    recipientIds: string[],
  ): Promise<void> {
    const notifications = recipientIds.map((recipientId) =>
      this.createNotification({
        journeyId,
        recipientId,
        type: 'PARTICIPANT_JOINED',
        title: 'Participant Joined',
        body: `${participantName} joined the journey`,
        data: { journeyName, participantName },
      }),
    );

    await Promise.all(notifications);
  }

  /**
   * Send arrival detected notification
   */
  async sendArrivalDetected(
    journeyId: string,
    journeyName: string,
    participantName: string,
    recipientIds: string[],
  ): Promise<void> {
    const notifications = recipientIds.map((recipientId) =>
      this.createNotification({
        journeyId,
        recipientId,
        type: 'ARRIVAL_DETECTED',
        title: 'Arrival Detected',
        body: `${participantName} has arrived at the destination`,
        data: { journeyName, participantName },
      }),
    );

    await Promise.all(notifications);
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(
    userId: string,
    limit: number = 50,
  ): Promise<Notification[]> {
    const notifications = await this.notificationRepository.findByRecipient(
      userId,
      limit,
    );
    return notifications as unknown as Notification[];
  }

  /**
   * Mark notification as read
   * Uses recipientId to scope query and prevent unauthorized access (IDOR protection)
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    // Keyed update scoped by recipient (IDOR protection). Returns false when
    // nothing matched.
    const updated = await this.notificationRepository.markAsRead(
      notificationId,
      userId,
    );

    if (!updated) {
      throw new NotFoundException(
        'Notification not found or you do not have permission to access it',
      );
    }
  }

  /**
   * Delete notification
   * Uses recipientId to scope query and prevent unauthorized access (IDOR protection)
   */
  async deleteNotification(
    notificationId: string,
    userId: string,
  ): Promise<void> {
    // Keyed delete scoped by recipient (IDOR protection).
    const deleted = await this.notificationRepository.delete(
      notificationId,
      userId,
    );

    if (!deleted) {
      throw new NotFoundException(
        'Notification not found or you do not have permission to access it',
      );
    }
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepository.getUnreadCount(userId);
  }

  /**
   * Helper method to convert data object to string record for FCM
   */
  private convertDataToStringRecord(
    data: Record<string, unknown>,
  ): Record<string, string> {
    const stringRecord: Record<string, string> = {};

    for (const [key, value] of Object.entries(data)) {
      stringRecord[key] =
        typeof value === 'string' ? value : JSON.stringify(value);
    }

    return stringRecord;
  }

  /**
   * Check if user has enabled notifications (has registered FCM token)
   */
  async getNotificationPermissionStatus(userId: string): Promise<{
    enabled: boolean;
    tokenCount: number;
  }> {
    const tokenCount = await this.fcmTokenRepository.countForUser(userId);

    return {
      enabled: tokenCount > 0,
      tokenCount,
    };
  }

  /**
   * Register FCM token for push notifications
   */
  async registerFcmToken(
    userId: string,
    fcmToken: string,
    platform?: string,
    deviceId?: string,
  ): Promise<{ message: string }> {
    try {
      this.logger.log(`Registering FCM token for user: ${userId}`);
      this.logger.debug(`Platform: ${platform || 'unknown'}`);

      const user = await this.usersRepository.findById(userId);
      if (!user) {
        this.logger.warn(`User not found: ${userId}`);
        throw new NotFoundException('User not found');
      }

      // ON CONFLICT (user_id, token) DO NOTHING — inserted=false means the
      // token was already registered (replaces arrayUnion dedupe).
      const inserted = await this.fcmTokenRepository.add({
        userId,
        token: fcmToken,
        platform: platform || 'unknown',
        deviceId,
      });

      if (inserted) {
        this.logger.log(
          `FCM token registered successfully for user: ${userId}`,
        );
        return { message: 'FCM token registered successfully' };
      }

      this.logger.debug('FCM token already registered');
      return { message: 'FCM token already registered' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Log the actual error for debugging
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `FCM token registration error for user ${userId}: ${errorMessage}`,
        errorStack,
      );
      throw new BadRequestException(
        `Failed to register FCM token: ${errorMessage}`,
      );
    }
  }

  /**
   * Remove FCM token (e.g., on logout from specific device)
   */
  async removeFcmToken(
    userId: string,
    fcmToken: string,
  ): Promise<{ message: string }> {
    try {
      const user = await this.usersRepository.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      await this.fcmTokenRepository.remove(userId, fcmToken);

      return { message: 'FCM token removed successfully' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `FCM token removal error for user ${userId}: ${errorMessage}`,
        errorStack,
      );
      throw new BadRequestException('Failed to remove FCM token');
    }
  }

  /**
   * Get all FCM tokens for a user (used by FcmService)
   */
  async getUserFcmTokens(userId: string): Promise<string[]> {
    return this.fcmTokenRepository.getTokens(userId);
  }
}
