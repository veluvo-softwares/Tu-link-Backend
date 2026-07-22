import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class LocationCoordinateDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;
}

class MetadataDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  batteryLevel?: number;

  @IsOptional()
  @IsBoolean()
  isMoving?: boolean;

  @IsOptional()
  @IsBoolean()
  statusChange?: boolean;
}

export class LocationUpdateDto {
  @IsString()
  journeyId: string;

  @ValidateNested()
  @Type(() => LocationCoordinateDto)
  location: LocationCoordinateDto;

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

  @IsNumber()
  timestamp: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientPointId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetadataDto)
  metadata?: MetadataDto;
}
