import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { RegisterFcmTokenDto, RemoveFcmTokenDto } from './dto/register-fcm-token.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(FirebaseAuthGuard)
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  /**
   * Check notification permission status
   */
  @Get('permission-status')
  @ApiOperation({
    summary: 'Check if user has registered FCM token for notifications',
    description: `Check if the current user has enabled push notifications by registering at least one FCM token.

**Returns:**
- \`enabled\`: true if user has at least one FCM token registered
- \`tokenCount\`: Number of devices registered for notifications

**Use Case:**
- Call this on app launch to determine whether to show notification permission prompt
- If \`enabled: false\`, show prompt to enable notifications`
  })
  @ApiResponse({
    status: 200,
    description: 'Permission status retrieved',
    schema: {
      example: {
        enabled: true,
        tokenCount: 2
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getNotificationPermissionStatus(@CurrentUser('uid') userId: string) {
    return this.notificationService.getNotificationPermissionStatus(userId);
  }

  /**
   * Register FCM token for push notifications
   */
  @Post('fcm-token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register FCM token for push notifications',
    description: `Register a Firebase Cloud Messaging token to receive push notifications for journey events.

**Permission Flow:**
1. User opens app for first time
2. Call \`GET /notifications/permission-status\` to check if notifications enabled
3. If not enabled, show permission prompt in UI
4. User accepts → Request notification permission from OS
5. Get FCM token from device
6. Call this endpoint to register token

**Journey Notifications:**
- Journey started (when leader starts journey)
- Journey ended (when leader ends journey)
- Participant arrival at destination
- Lag alerts when falling behind (WARNING/CRITICAL)
- Journey invitation received

**Token Management:**
- Tokens are stored per device (supports multiple devices per user)
- Same token can only be registered once
- Include platform and deviceId for better tracking
- Invalid tokens are automatically cleaned up`
  })
  @ApiResponse({
    status: 201,
    description: 'FCM token registered successfully',
    schema: {
      example: {
        message: 'FCM token registered successfully'
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Failed to register FCM token' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async registerFcmToken(
    @CurrentUser('uid') userId: string,
    @Body() registerFcmTokenDto: RegisterFcmTokenDto,
  ) {
    return this.notificationService.registerFcmToken(
      userId,
      registerFcmTokenDto.fcmToken,
      registerFcmTokenDto.platform,
      registerFcmTokenDto.deviceId,
    );
  }

  /**
   * Remove FCM token
   */
  @Delete('fcm-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove FCM token',
    description: `Remove a Firebase Cloud Messaging token from user profile.

**Use When:**
- User logs out from a specific device
- User disables notifications in app settings
- Token becomes invalid or expired
- Uninstalling the app (call before uninstall if possible)

**Multi-Device Support:**
Users can have multiple tokens (one per device). This only removes the specified token, other devices will continue receiving notifications.`
  })
  @ApiResponse({
    status: 200,
    description: 'FCM token removed successfully',
    schema: {
      example: {
        message: 'FCM token removed successfully'
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Failed to remove FCM token' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async removeFcmToken(
    @CurrentUser('uid') userId: string,
    @Body() removeFcmTokenDto: RemoveFcmTokenDto,
  ) {
    return this.notificationService.removeFcmToken(userId, removeFcmTokenDto.fcmToken);
  }

  /**
   * Get user's notifications
   */
  @Get()
  @ApiOperation({
    summary: 'Get user notifications',
    description: 'Retrieve all notifications for the current user with optional limit'
  })
  @ApiResponse({ status: 200, description: 'Notifications retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUserNotifications(
    @CurrentUser('uid') userId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.notificationService.getUserNotifications(userId, limit || 50);
  }

  /**
   * Get unread notification count
   */
  @Get('unread-count')
  async getUnreadCount(@CurrentUser('uid') userId: string) {
    const count = await this.notificationService.getUnreadCount(userId);
    return { count };
  }

  /**
   * Mark notification as read
   */
  @Put(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Param('notificationId') notificationId: string,
  ) {
    await this.notificationService.markAsRead(notificationId);

    return {
      success: true,
      statusCode: 200,
      message: 'Notification marked as read'
    };
  }

  /**
   * Delete notification
   */
  @Delete(':notificationId')
  @HttpCode(HttpStatus.OK)
  async deleteNotification(
    @Param('notificationId') notificationId: string,
  ) {
    await this.notificationService.deleteNotification(notificationId);

    // Return standard response format (interceptor will recognize and pass through)
    return {
      success: true,
      statusCode: 200,
      message: 'Notification deleted successfully'
    };
  }
}
