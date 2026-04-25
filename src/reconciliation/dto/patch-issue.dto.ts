import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IssueStatus, IssuePriority } from '../enums/issue-status.enum';

export class PatchIssueDto {
  @ApiPropertyOptional({ enum: IssueStatus })
  @IsOptional()
  @IsEnum(IssueStatus)
  status?: IssueStatus;

  @ApiPropertyOptional({ enum: IssuePriority })
  @IsOptional()
  @IsEnum(IssuePriority)
  priority?: IssuePriority;

  @ApiPropertyOptional({ description: 'Resolution note shown to the customer' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  resolutionNote?: string;

  @ApiPropertyOptional({ description: 'Internal staff note (not shown to customer)' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  internalNote?: string;

  @ApiPropertyOptional({ description: 'Reassign to a different admin user' })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;
}
