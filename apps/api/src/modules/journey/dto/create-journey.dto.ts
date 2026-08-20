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

export class CreateJourneyDto {
  @IsString()
  name: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  destination?: LocationDto;

  /**
   * Human-readable place name (e.g. "Karen Shopping Centre"). Optional so
   * clients released before this field keep working; consumers fall back to
   * destinationAddress when it is absent.
   */
  @IsOptional()
  @IsString()
  destinationName?: string;

  @IsOptional()
  @IsString()
  destinationAddress?: string;

  @IsOptional()
  @IsNumber()
  @Min(100)
  lagThresholdMeters?: number;

  /**
   * Schedule the journey for a future instant (ISO-8601, UTC). The journey
   * is created PENDING as usual; the scheduler handles reminders and start.
   */
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;

  /** Scheduled journeys only: start automatically at scheduledFor. */
  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;
}
