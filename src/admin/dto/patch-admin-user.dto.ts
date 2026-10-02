import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
} from 'class-validator';
import { AdminPermission } from '../../common/enums/admin-permission.enum';
import {
  ASSIGNABLE_ADMIN_ROLES,
  type AssignableAdminRole,
} from './create-admin-user.dto';

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

  @ApiPropertyOptional({
    enum: ASSIGNABLE_ADMIN_ROLES,
    description: 'Promote to ADMIN_SUPER or demote to ADMIN_STAFF',
  })
  @IsOptional()
  @IsIn(ASSIGNABLE_ADMIN_ROLES)
  role?: AssignableAdminRole;
}
