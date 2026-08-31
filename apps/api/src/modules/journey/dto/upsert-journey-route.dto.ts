import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { JourneyRouteReason } from '../../../database/repositories/journey-route.repository';

export const JOURNEY_ROUTE_REASONS = [
  'INITIAL',
  'LEADER_REROUTE',
  'MANUAL',
] as const;

export class UpsertJourneyRouteDto {
  @ApiProperty({ description: 'Latitude from which routing should begin' })
  @Type(() => Number)
  @IsLatitude()
  originLat: number;

  @ApiProperty({ description: 'Longitude from which routing should begin' })
  @Type(() => Number)
  @IsLongitude()
  originLng: number;

  @ApiProperty({
    description: 'Current route version known by the leader; zero initially',
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  baseVersion: number;

  @ApiProperty({ enum: JOURNEY_ROUTE_REASONS })
  @IsEnum(JOURNEY_ROUTE_REASONS)
  reason: JourneyRouteReason;

  @ApiProperty({
    description: 'UUID used to make retried route requests idempotent',
  })
  @IsUUID('4')
  requestId: string;
}
