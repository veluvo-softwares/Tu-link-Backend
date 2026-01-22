import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../../../shared/firebase/firebase.service';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  constructor(private firebaseService: FirebaseService) {}

  /**
   * Send push notification to specific user tokens
   */
  async sendToUser(
    fcmTokens: string[],
    notification: PushNotificationPayload,
  ): Promise<{ success: boolean; sentCount: number; failedTokens: string[] }> {
    try {
      if (fcmTokens.length === 0) {
        this.logger.warn('No FCM tokens provided');
        return { success: true, sentCount: 0, failedTokens: [] };
      }

      // Send to all user devices
      return await this.sendToTokens(fcmTokens, notification);
    } catch (error) {
      this.logger.error('Failed to send notification:', error);
      return { success: false, sentCount: 0, failedTokens: [] };
    }
  }

  /**
   * Send push notification to multiple user token arrays
   */
  async sendToMultipleUsers(
    userTokenArrays: string[][],
    notification: PushNotificationPayload,
  ): Promise<{ totalSent: number; totalFailed: number }> {
    const results = await Promise.allSettled(
      userTokenArrays.map((tokens) => this.sendToUser(tokens, notification)),
    );

    let totalSent = 0;
    let totalFailed = 0;

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        totalSent += result.value.sentCount;
        totalFailed += result.value.failedTokens.length;
      }
    });

    this.logger.log(
      `Sent notifications to ${userTokenArrays.length} users: ${totalSent} successful, ${totalFailed} failed`,
    );

    return { totalSent, totalFailed };
  }

  /**
   * Send push notification to specific FCM tokens
   */
  private async sendToTokens(
    tokens: string[],
    notification: PushNotificationPayload,
  ): Promise<{ success: boolean; sentCount: number; failedTokens: string[] }> {
    try {
      // Build message payload
      const message: any = {
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data || {},
      };

      // Add image if provided
      if (notification.imageUrl) {
        message.notification.imageUrl = notification.imageUrl;
      }

      // Configure Android-specific options
      message.android = {
        priority: 'high' as const,
        notification: {
          channelId: 'tulink_journey_updates',
          sound: 'default',
          priority: 'high' as const,
        },
      };

      // Configure iOS-specific options
      message.apns = {
        payload: {
          aps: {
            sound: 'default',
            contentAvailable: true,
          },
        },
      };

      // Send to multiple tokens
      const response = await this.firebaseService.messaging.sendEachForMulticast({
        tokens,
        ...message,
      });

      // Track failed tokens for cleanup
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
          this.logger.warn(
            `Failed to send to token ${tokens[idx]}: ${resp.error?.message}`,
          );
        }
      });

      // Remove invalid tokens from database
      if (failedTokens.length > 0) {
        await this.removeInvalidTokens(failedTokens);
      }

      return {
        success: response.successCount > 0,
        sentCount: response.successCount,
        failedTokens,
      };
    } catch (error) {
      this.logger.error('Error sending FCM notifications:', error);
      return { success: false, sentCount: 0, failedTokens: tokens };
    }
  }

  /**
   * Remove invalid/expired FCM tokens from all users
   * Processes in batches of 10 to comply with Firestore's array-contains-any limit
   */
  private async removeInvalidTokens(tokens: string[]): Promise<void> {
    try {
      // Process in batches of 10 (Firestore array-contains-any limit)
      for (let i = 0; i < tokens.length; i += 10) {
        const batch = tokens.slice(i, i + 10);

        this.logger.log(`Processing token cleanup batch ${Math.floor(i / 10) + 1} (${batch.length} tokens)`);

        // Query users with any of these tokens
        const usersSnapshot = await this.firebaseService.firestore
          .collection('users')
          .where('fcmTokens', 'array-contains-any', batch)
          .get();

        const updatePromises = usersSnapshot.docs.map(async (doc) => {
          const userData = doc.data();
          const fcmTokens = userData.fcmTokens || [];

          // Filter out all invalid tokens (not just from current batch)
          const validTokens = fcmTokens.filter(
            (tokenData: any) => !tokens.includes(tokenData.token),
          );

          if (validTokens.length !== fcmTokens.length) {
            await doc.ref.update({ fcmTokens: validTokens });
            const removedCount = fcmTokens.length - validTokens.length;
            this.logger.log(`Removed ${removedCount} invalid token(s) from user ${doc.id}`);
          }
        });

        await Promise.all(updatePromises);
      }

      this.logger.log(`Token cleanup complete: processed ${tokens.length} invalid tokens`);
    } catch (error) {
      this.logger.error('Error removing invalid tokens:', error);
    }
  }

}
