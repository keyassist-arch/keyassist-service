import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminDismissManualImportDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;
}
