import { IsString, IsEmail } from 'class-validator';

export class InviteParticipantDto {
  @IsString()
  @IsEmail()
  email: string;
}

export class InviteParticipantByIdDto {
  @IsString()
  invitedUserId: string;
}
