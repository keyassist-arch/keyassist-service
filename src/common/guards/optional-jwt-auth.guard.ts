import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { isObservable, firstValueFrom } from 'rxjs';

/**
 * Public routes stay public. When a bearer token is present and valid, `req.user`
 * is set so catalog queries can include that shopper's own product requests.
 * A missing or rejected token does not fail the request.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) {
      return true;
    }

    try {
      const result = super.canActivate(context);
      if (isObservable(result)) {
        await firstValueFrom(result);
      } else {
        await result;
      }
    } catch {
      // Invalid or expired token: treat the caller as anonymous.
    }
    return true;
  }

  handleRequest<TUser>(err: Error | undefined, user: TUser): TUser | null {
    if (err || !user) return null;
    return user;
  }
}
