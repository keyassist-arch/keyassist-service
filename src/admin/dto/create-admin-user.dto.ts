import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AdminPermission } from '../../common/enums/admin-permission.enum';
import { UserRole } from '../../common/enums/role.enum';

export const ASSIGNABLE_ADMIN_ROLES = [
  UserRole.ADMIN_STAFF,
  UserRole.ADMIN_SUPER,
] as const;
export type AssignableAdminRole = (typeof ASSIGNABLE_ADMIN_ROLES)[number];

export class CreateAdminUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ enum: AdminPermission, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(AdminPermission, { each: true })
  permissions: AdminPermission[];

  @ApiPropertyOptional({
    enum: ASSIGNABLE_ADMIN_ROLES,
    default: UserRole.ADMIN_STAFF,
    description: 'ADMIN_SUPER implicitly has every permission',
  })
  @IsOptional()
  @IsIn(ASSIGNABLE_ADMIN_ROLES)
  role?: AssignableAdminRole;
}
