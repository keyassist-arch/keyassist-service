import { SetMetadata } from '@nestjs/common';
import { AdminPermission } from '../enums/admin-permission.enum';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';
export const RequirePermission = (...permissions: AdminPermission[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
