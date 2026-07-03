import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { isEnvFlagEnabled } from '../utils/env-flag.util';

/**
 * Blocks checkout until the user has verified their phone via WhatsApp OTP.
 * Controlled by PHONE_VERIFICATION_REQUIRED (default off) so checkout isn't
 * blocked before a WhatsApp provider is actually configured.
 */
@Injectable()
export class PhoneVerifiedGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = isEnvFlagEnabled(
      this.config.get<string>('PHONE_VERIFICATION_REQUIRED'),
    );
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const jwtUser = request.user;
    if (!jwtUser) {
      return false;
    }

    const user = await this.usersService.findById(jwtUser.sub);
    if (!user.phoneVerifiedAt) {
      throw new ForbiddenException({
        message: 'Verify your phone number via WhatsApp before checking out.',
        code: 'PHONE_VERIFICATION_REQUIRED',
      });
    }
    return true;
  }
}
