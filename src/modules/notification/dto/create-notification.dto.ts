import { IsString, IsObject, IsEnum } from 'class-validator';
import type { NotificationType } from '../../../types/notification.type';

export class CreateNotificationDto {
  @IsString()
  journeyId: string;

  @IsString()
  recipientId: string;

  @IsEnum([
    'JOURNEY_INVITE',
    'JOURNEY_STARTED',
    'JOURNEY_ENDED',
    'LAG_ALERT',
    'PARTICIPANT_JOINED',
    'PARTICIPANT_LEFT',
    'ARRIVAL_DETECTED',
    'CONVOY_JOINED',
  ])
  type: NotificationType;

  @IsString()
  title: string;

  @IsString()
  body: string;

  @IsObject()
  data: Record<string, any>;
}
