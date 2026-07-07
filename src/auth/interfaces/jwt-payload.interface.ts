import { UserRole } from '../../common/enums/role.enum';
import { AdminPermission } from '../../common/enums/admin-permission.enum';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  /** Only meaningful for ADMIN_STAFF — ADMIN_SUPER implicitly has all permissions. */
  permissions?: AdminPermission[];
}
