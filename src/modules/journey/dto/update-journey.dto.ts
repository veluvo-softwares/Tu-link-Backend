import {
  IsBoolean,
  IsISO8601,
  IsString,
  IsOptional,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class LocationDto {
  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;
}

export class UpdateJourneyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  destination?: LocationDto;

  @IsOptional()
  @IsString()
  destinationAddress?: string;

  @IsOptional()
  @IsNumber()
  @Min(100)
  lagThresholdMeters?: number;

  /** Move the scheduled start (ISO-8601). Resets the reminder ladder. */
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;

  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;
}
