import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class ResyncDto {
  @IsNumber()
  @Min(0)
  fromSequence: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  limit?: number;
}
