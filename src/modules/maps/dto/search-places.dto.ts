import {
  IsString,
  IsOptional,
  IsNumber,
  MinLength,
  Length,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class SearchPlacesDto {
  @IsString()
  @MinLength(3, { message: 'Query must be at least 3 characters long' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  query: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Latitude must be a valid number' })
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Longitude must be a valid number' })
  lng?: number;

  @IsOptional()
  @IsString()
  @Length(2, 2, { message: 'regionCode must be a 2-letter ISO 3166-1 code' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  regionCode?: string;
}
