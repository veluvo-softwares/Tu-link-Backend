import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../../../shared/firebase/firebase.service';
import { FcmTokenRepository } from '../../../database/repositories/fcm-token.repository';
import { MulticastMessage } from 'firebase-admin/messaging';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  constructor(
    private firebaseService: FirebaseService,
    private fcmTokenRepository: FcmTokenRepository,
  ) {}

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
      // Build message payload using Firebase types
      const message: Omit<MulticastMessage, 'tokens'> = {
        notification: {
          title: notification.title,
          body: notification.body,
          ...(notification.imageUrl && { imageUrl: notification.imageUrl }),
        },
        data: notification.data || {},
        android: {
          priority: 'high',
          notification: {
            channelId: 'tulink_journey_updates',
            sound: 'default',
            priority: 'high',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              contentAvailable: true,
            },
          },
        },
      };

      // Send to multiple tokens
      const response =
        await this.firebaseService.messaging.sendEachForMulticast({
          tokens,
          ...message,
        });

      // Track failed tokens for cleanup. Only tokens that FCM reports as
      // permanently invalid are removed — transient failures (e.g. server
      // errors, rate limits) must be preserved so the device isn't silently
      // unsubscribed.
      // Only codes that mean THIS token can never receive a message. Excludes
      // config/payload errors (mismatched-credential, third-party-auth-error,
      // payload-size-limit-exceeded) which affect the request, not the token,
      // and would otherwise unsubscribe healthy devices.
      const permanentFailureCodes = new Set([
        'messaging/registration-token-not-registered',
        'messaging/invalid-argument',
        'messaging/invalid-registration-token',
        'messaging/invalid-recipient',
        'messaging/invalid-package-name',
      ]);
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          this.logger.warn(
            `Failed to send to token ${tokens[idx]}: ${resp.error?.message}`,
          );
          if (resp.error && permanentFailureCodes.has(resp.error.code)) {
            failedTokens.push(tokens[idx]);
          }
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
   * Remove invalid/expired FCM tokens across all users.
   * One DELETE replaces the batched array-contains-any scan + per-user rewrite.
   */
  private async removeInvalidTokens(tokens: string[]): Promise<void> {
    try {
      await this.fcmTokenRepository.removeTokens(tokens);
      this.logger.log(
        `Token cleanup complete: removed ${tokens.length} invalid token(s)`,
      );
    } catch (error) {
      this.logger.error('Error removing invalid tokens:', error);
    }
  }
}
