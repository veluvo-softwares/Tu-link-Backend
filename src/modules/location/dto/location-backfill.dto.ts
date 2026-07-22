import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  MinLength,
  Min,
  ValidateNested,
} from 'class-validator';

class BackfillCoordinateDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;
}

class BackfillMetadataDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  batteryLevel?: number;

  @IsOptional()
  @IsBoolean()
  isMoving?: boolean;
}

export class LocationBackfillPointDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  clientPointId: string;

  @IsNumber()
  @Min(1)
  recordedAt: number;

  @ValidateNested()
  @Type(() => BackfillCoordinateDto)
  location: BackfillCoordinateDto;

  @IsNumber()
  @Min(0)
  accuracy: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @IsOptional()
  @IsNumber()
  altitude?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => BackfillMetadataDto)
  metadata?: BackfillMetadataDto;
}

export class LocationBackfillDto {
  @IsString()
  journeyId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  batchId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LocationBackfillPointDto)
  points: LocationBackfillPointDto[];
}

export interface LocationBackfillAck {
  batchId: string;
  acknowledgedPointIds: string[];
  acceptedPointIds: string[];
  duplicatePointIds: string[];
  rejected: Array<{ clientPointId: string; reason: string }>;
  nextSequence: number;
}
