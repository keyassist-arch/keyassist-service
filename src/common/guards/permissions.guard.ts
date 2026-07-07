import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../enums/role.enum';
import { AdminPermission } from '../enums/admin-permission.enum';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

/**
 * Screen-level gate for ADMIN_STAFF, layered on top of `RolesGuard`.
 * ADMIN_SUPER always passes — it implicitly has every permission.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<
      AdminPermission[]
    >(REQUIRE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredPermissions?.length) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException();
    }
    if (user.role === UserRole.ADMIN_SUPER) {
      return true;
    }
    const granted = user.permissions ?? [];
    const hasAll = requiredPermissions.every((p) => granted.includes(p));
    if (!hasAll) {
      throw new ForbiddenException('Insufficient permission');
    }
    return true;
  }
}
