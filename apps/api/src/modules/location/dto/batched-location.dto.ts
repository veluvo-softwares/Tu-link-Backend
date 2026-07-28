import { IsArray, IsNumber, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LocationUpdate } from '../../../shared/interfaces/location.interface';
import type { LocationStrategy } from '../../../shared/interfaces/websocket-strategy.interface';

export class BatchedLocationUpdatesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  updates: LocationUpdate[];

  @IsNumber()
  count: number;

  @IsNumber()
  timestamp: number;

  @IsString()
  strategy: LocationStrategy;
}

export class LocationUpdateAckDto {
  @IsNumber()
  sequenceNumber: number;

  @IsString()
  strategy: LocationStrategy;

  @IsNumber()
  nextBroadcast?: number;

  @IsString()
  pollEndpoint?: string;

  @IsNumber()
  recommendedInterval?: number;
}
