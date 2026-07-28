import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterFcmTokenDto {
  @ApiProperty({
    description: 'Firebase Cloud Messaging token for push notifications',
    example: 'fGxN8... [FCM Registration Token]',
  })
  @IsString()
  @IsNotEmpty({ message: 'FCM token is required' })
  fcmToken: string;

  @ApiProperty({
    description: 'Device platform (android, ios, web)',
    example: 'android',
    enum: ['android', 'ios', 'web'],
    required: false,
  })
  @IsString()
  @IsOptional()
  @IsEnum(['android', 'ios', 'web'], {
    message: 'Platform must be android, ios, or web',
  })
  platform?: string;

  @ApiProperty({
    description: 'Device identifier (optional)',
    example: 'device-uuid-123',
    required: false,
  })
  @IsString()
  @IsOptional()
  deviceId?: string;
}

export class RemoveFcmTokenDto {
  @ApiProperty({
    description: 'FCM token to remove',
    example: 'fGxN8... [FCM Registration Token]',
  })
  @IsString()
  @IsNotEmpty({ message: 'FCM token is required' })
  fcmToken: string;
}
