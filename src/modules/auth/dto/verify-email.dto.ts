import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Email verification OTP code',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  oobCode: string;
}
