import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BatchStatus } from '../../common/enums/batch-status.enum';

export class AdminBatchStatusDto {
  @ApiProperty({ enum: BatchStatus })
  @IsEnum(BatchStatus)
  status: BatchStatus;
}
