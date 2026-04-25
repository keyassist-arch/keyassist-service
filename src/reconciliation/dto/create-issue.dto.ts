import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IssueType, IssuePriority } from '../enums/issue-status.enum';

export class CreateIssueDto {
  @ApiPropertyOptional({ description: 'Related order ID (optional)' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiProperty({ description: 'Customer user ID' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: IssueType })
  @IsEnum(IssueType)
  type: IssueType;

  @ApiPropertyOptional({ enum: IssuePriority, default: IssuePriority.MEDIUM })
  @IsOptional()
  @IsEnum(IssuePriority)
  priority?: IssuePriority;

  @ApiProperty({ maxLength: 256 })
  @IsString()
  @MaxLength(256)
  subject: string;

  @ApiProperty()
  @IsString()
  @MaxLength(4096)
  description: string;

  @ApiPropertyOptional({ description: 'Internal staff note' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  internalNote?: string;

  @ApiPropertyOptional({ description: 'Admin user ID to assign the issue to' })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;
}
