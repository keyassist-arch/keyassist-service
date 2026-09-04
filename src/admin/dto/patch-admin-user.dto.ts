import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { AdminPermission } from '../../common/enums/admin-permission.enum';

export class PatchAdminUserDto {
  @ApiPropertyOptional({ enum: AdminPermission, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(AdminPermission, { each: true })
  permissions?: AdminPermission[];

  @ApiPropertyOptional({ description: 'Disable or re-enable this admin account' })
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
