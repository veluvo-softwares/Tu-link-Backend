import { IsString, IsEmail, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteParticipantDto {
  @ApiProperty({
    description: 'Email address of the user to invite',
    example: 'user@example.com',
  })
  @IsString()
  @IsEmail()
  email: string;
}

export class InviteParticipantByIdDto {
  @ApiProperty({
    description: 'Firebase User ID of the user to invite',
    example: 'N8BPeJvNBMZIdjGMVpMOhxBH5f13',
    pattern: '^[a-zA-Z0-9_-]+$',
  })
  @IsString()
  @IsNotEmpty({ message: 'User ID cannot be empty' })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message:
      'User ID must contain only alphanumeric characters, hyphens, and underscores',
  })
  invitedUserId: string;
}
