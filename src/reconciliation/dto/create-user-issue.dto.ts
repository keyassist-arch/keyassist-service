import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IssueType } from '../enums/issue-status.enum';

export class CreateUserIssueDto {
  @ApiPropertyOptional({ description: 'Related order ID (optional)' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiProperty({
    enum: IssueType,
    description: 'Type of issue',
    example: IssueType.OTHER,
  })
  @IsEnum(IssueType)
  type: IssueType;

  @ApiProperty({ description: 'Brief subject/title for the issue', maxLength: 256 })
  @IsString()
  @MaxLength(256)
  subject: string;

  @ApiProperty({ description: 'Detailed description of the issue', maxLength: 4096 })
  @IsString()
  @MaxLength(4096)
  description: string;
}
