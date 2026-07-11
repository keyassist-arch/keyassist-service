import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BatchStatus } from '../../common/enums/batch-status.enum';

export class AdminBatchStatusDto {
  @ApiProperty({ enum: BatchStatus })
  @IsEnum(BatchStatus)
  status: BatchStatus;

  /**
   * Only meaningful on Processing → Placing Orders. Pass `'reassign'` to confirm
   * moving unpaid items to the next batch and proceed anyway — otherwise that
   * transition 409s with the list of unpaid items instead of advancing.
   */
  @ApiPropertyOptional({ enum: ['reassign'] })
  @IsOptional()
  @IsIn(['reassign'])
  resolveUnpaid?: 'reassign';
}
