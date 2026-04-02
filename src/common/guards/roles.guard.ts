import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException();
    }
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
