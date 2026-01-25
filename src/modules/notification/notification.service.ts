import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { FcmService } from './services/fcm.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { Notification } from '../../shared/interfaces/notification.interface';
import { NotificationType } from '../../types/notification.type';
import { FieldValue } from 'firebase-admin/firestore';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private firebaseService: FirebaseService,
    private fcmService: FcmService,
  ) {}

  /**
   * Create and send a notification
   */
  async createNotification(
    createNotificationDto: CreateNotificationDto,
  ): Promise<Notification> {
    const notificationRef = this.firebaseService.firestore
      .collection('journeys')
      .doc(createNotificationDto.journeyId)
      .collection('notifications')
      .doc();

    const notificationData = {
      journeyId: createNotificationDto.journeyId,
      recipientId: createNotificationDto.recipientId,
      type: createNotificationDto.type,
      title: createNotificationDto.title,
      body: createNotificationDto.body,
      data: createNotificationDto.data,
      read: false,
      createdAt: FieldValue.serverTimestamp() as any,
    };

    await notificationRef.set(notificationData);

    // Send FCM push notification
    const userTokens = await this.getUserFcmTokens(createNotificationDto.recipientId);
    await this.fcmService.sendToUser(userTokens, {
      title: createNotificationDto.title,
      body: createNotificationDto.body,
      data: this.convertDataToStringRecord(createNotificationDto.data),
    });

    return { id: notificationRef.id, ...notificationData } as Notification;
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
    const title = severity === 'CRITICAL' ? 'Critical Lag Alert' : 'Lag Warning';
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
  async getUserNotifications(userId: string, limit: number = 50): Promise<Notification[]> {
    const snapshot = await this.firebaseService.firestore
      .collectionGroup('notifications')
      .where('recipientId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Notification[];
  }

  /**
   * Mark notification as read
   * Uses recipientId to scope query and prevent unauthorized access (IDOR protection)
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    // Query scoped to user's notifications only for security and performance
    const snapshot = await this.firebaseService.firestore
      .collectionGroup('notifications')
      .where('recipientId', '==', userId)
      .limit(1000) // Reasonable limit per user
      .get();

    // Find the specific notification by ID
    const notificationDoc = snapshot.docs.find(doc => doc.id === notificationId);

    if (!notificationDoc) {
      throw new NotFoundException('Notification not found or you do not have permission to access it');
    }

    await notificationDoc.ref.update({
      read: true,
      readAt: FieldValue.serverTimestamp(),
    });
  }

  /**
   * Delete notification
   * Uses recipientId to scope query and prevent unauthorized access (IDOR protection)
   */
  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    // Query scoped to user's notifications only for security and performance
    const snapshot = await this.firebaseService.firestore
      .collectionGroup('notifications')
      .where('recipientId', '==', userId)
      .limit(1000) // Reasonable limit per user
      .get();

    // Find the specific notification by ID
    const notificationDoc = snapshot.docs.find(doc => doc.id === notificationId);

    if (!notificationDoc) {
      throw new NotFoundException('Notification not found or you do not have permission to access it');
    }

    await notificationDoc.ref.delete();
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(userId: string): Promise<number> {
    const snapshot = await this.firebaseService.firestore
      .collectionGroup('notifications')
      .where('recipientId', '==', userId)
      .where('read', '==', false)
      .get();

    return snapshot.size;
  }

  /**
   * Helper method to convert data object to string record for FCM
   */
  private convertDataToStringRecord(data: Record<string, any>): Record<string, string> {
    const stringRecord: Record<string, string> = {};

    for (const [key, value] of Object.entries(data)) {
      stringRecord[key] = typeof value === 'string' ? value : JSON.stringify(value);
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
    const userDoc = await this.firebaseService.firestore
      .collection('users')
      .doc(userId)
      .get();

    if (!userDoc.exists) {
      return { enabled: false, tokenCount: 0 };
    }

    const userData = userDoc.data();
    const fcmTokens = userData?.fcmTokens || [];

    return {
      enabled: fcmTokens.length > 0,
      tokenCount: fcmTokens.length,
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

      const userRef = this.firebaseService.firestore.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        this.logger.warn(`User not found: ${userId}`);
        throw new NotFoundException('User not found');
      }

      // Get existing FCM tokens array
      const userData = userDoc.data();
      const existingTokens = userData?.fcmTokens || [];
      this.logger.debug(`Existing tokens count: ${existingTokens.length}`);

      // Check if token already exists
      const tokenExists = existingTokens.some((t: any) => t.token === fcmToken);

      if (!tokenExists) {
        this.logger.log('Adding new FCM token');

        // Add new token with metadata
        // Note: Using ISO string instead of FieldValue.serverTimestamp()
        // because Firestore doesn't allow serverTimestamp in array elements
        const tokenData = {
          token: fcmToken,
          platform: platform || 'unknown',
          deviceId: deviceId || null,
          registeredAt: new Date().toISOString(),
        };

        // Use set with merge to handle cases where fcmTokens field doesn't exist
        await userRef.set(
          {
            fcmTokens: FieldValue.arrayUnion(tokenData),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        this.logger.log(`FCM token registered successfully for user: ${userId}`);
        return { message: 'FCM token registered successfully' };
      }

      this.logger.debug('FCM token already registered');
      return { message: 'FCM token already registered' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Log the actual error for debugging
      this.logger.error(`FCM token registration error for user ${userId}: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to register FCM token: ${error.message}`);
    }
  }

  /**
   * Remove FCM token (e.g., on logout from specific device)
   */
  async removeFcmToken(userId: string, fcmToken: string): Promise<{ message: string }> {
    try {
      const userRef = this.firebaseService.firestore.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new NotFoundException('User not found');
      }

      const userData = userDoc.data();
      const existingTokens = userData?.fcmTokens || [];

      // Filter out the token to remove
      const updatedTokens = existingTokens.filter((t: any) => t.token !== fcmToken);

      // Use set with merge to avoid issues
      await userRef.set(
        {
          fcmTokens: updatedTokens,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { message: 'FCM token removed successfully' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`FCM token removal error for user ${userId}: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to remove FCM token');
    }
  }

  /**
   * Get all FCM tokens for a user (used by FcmService)
   */
  async getUserFcmTokens(userId: string): Promise<string[]> {
    const userDoc = await this.firebaseService.firestore
      .collection('users')
      .doc(userId)
      .get();

    if (!userDoc.exists) {
      return [];
    }

    const userData = userDoc.data();
    const fcmTokens = userData?.fcmTokens || [];

    // Return just the token strings
    return fcmTokens.map((t: any) => t.token);
  }
}
