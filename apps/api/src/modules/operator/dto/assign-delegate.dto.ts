import { IsNotEmpty, IsString } from 'class-validator';

export class AssignDelegateDto {
  @IsString()
  @IsNotEmpty()
  clerkUserId: string;
}
