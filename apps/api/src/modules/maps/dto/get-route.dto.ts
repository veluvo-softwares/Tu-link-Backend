import { IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class GetRouteDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'originLat must be a valid number' })
  originLat: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'originLng must be a valid number' })
  originLng: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'destLat must be a valid number' })
  destLat: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'destLng must be a valid number' })
  destLng: number;
}
