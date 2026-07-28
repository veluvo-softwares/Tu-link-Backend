import { IsNumber, Min } from 'class-validator';

export class AcknowledgeDto {
  @IsNumber()
  @Min(0)
  sequenceNumber: number;
}
