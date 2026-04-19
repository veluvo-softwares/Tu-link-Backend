import { IsString, IsOptional, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SearchUserDto {
  @ApiProperty({
    description: 'Search query for user display name or email',
    example: 'wesley',
    minLength: 2,
  })
  @IsString()
  @MinLength(2, { message: 'Search query must be at least 2 characters long' })
  query: string;

  @ApiProperty({
    description: 'Maximum number of results to return',
    example: 10,
    default: 10,
    required: false,
  })
  @IsOptional()
  limit?: number;
}
