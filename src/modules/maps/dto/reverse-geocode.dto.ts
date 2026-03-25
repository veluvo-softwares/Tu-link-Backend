import { IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class ReverseGeocodeDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'Latitude must be a valid number' })
  lat: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Longitude must be a valid number' })
  lng: number;
}
