import { IsNotEmpty, IsString } from 'class-validator';

export class AddTeamMemberDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}
