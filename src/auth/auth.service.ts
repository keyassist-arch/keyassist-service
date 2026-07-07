import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { CartService } from '../cart/cart.service';
import { LocalCartItemDto } from '../cart/dto/local-cart-item.dto';
import { UsersService } from '../users/users.service';
import { UserRole } from '../common/enums/role.enum';
import { AdminPermission } from '../common/enums/admin-permission.enum';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailTemplateService } from '../notifications/email-templates.service';
import { TotpService } from '../totp/totp.service';

/** Claim set on password-reset JWTs (verified with `JWT_PASSWORD_RESET_SECRET`). */
const PASSWORD_RESET_CLAIM = 'pwd_reset' as const;

/** Claim set on email-verification JWTs. */
const EMAIL_VERIFY_CLAIM = 'email_verify' as const;

type PasswordResetJwtPayload = {
  sub: string;
  purpose: typeof PASSWORD_RESET_CLAIM;
};

type EmailVerifyJwtPayload = {
  sub: string;
  purpose: typeof EMAIL_VERIFY_CLAIM;
};

const TWO_FACTOR_PREAUTH_CLAIM = '2fa_preauth' as const;

type TwoFactorPreauthJwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
  purpose: typeof TWO_FACTOR_PREAUTH_CLAIM;
};

export const AUTH_ERROR_CODES = {
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',
} as const;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  /**
   * Pre-hashed sentinel used in `login` so bcrypt always runs, even when the
   * email is not found — prevents timing-based user enumeration.
   */
  private sentinelHash!: string;

  async onModuleInit() {
    this.sentinelHash = await bcrypt.hash('__sentinel__', 10);
  }

  constructor(
    private readonly usersService: UsersService,
    private readonly cartService: CartService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly emailTemplates: EmailTemplateService,
    private readonly totp: TotpService,
  ) {}

  async register(
    firstName: string,
    lastName: string,
    email: string,
    password: string,
    phone?: string,
  ) {
    const user = await this.usersService.create(
      firstName,
      lastName,
      email,
      password,
      phone,
    );
    this.logger.log(`[auth] step=register_ok userId=${user.id}`);
    try {
      await this.sendVerificationEmail(user, 'initial');
    } catch (err) {
      this.logger.error(
        `[auth] step=verification_email_failed userId=${user.id}`,
        err instanceof Error ? err.stack : err,
      );
    }
    return {
      requiresEmailVerification: true,
      email: user.email,
      message:
        'Check your inbox to verify your email. You can sign in after you confirm your address.',
    };
  }

  async login(email: string, password: string, localCart?: LocalCartItemDto[]) {
    const user = await this.usersService.findByEmailInsensitive(email);
    // Always run bcrypt regardless of whether the user exists — prevents
    // timing-based email enumeration (comparing against sentinel takes the
    // same wall-time as a real hash comparison).
    const isValidPassword = await bcrypt
      .compare(password, user?.passwordHash ?? this.sentinelHash)
      .catch(() => false);
    if (!user || !isValidPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.adminDisabledAt) {
      throw new UnauthorizedException('This admin account has been disabled');
    }
    if (!user.emailVerifiedAt) {
      let verificationEmailSent = false;
      try {
        await this.sendVerificationEmail(user, 'resend');
        verificationEmailSent = true;
      } catch (err) {
        this.logger.error(
          `[auth] step=login_verification_email_failed userId=${user.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
      throw new ForbiddenException({
        message: verificationEmailSent
          ? 'Please verify your email before signing in. We sent another confirmation link to your inbox.'
          : 'Please verify your email before signing in.',
        code: AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
        email: user.email,
        verificationEmailSent,
      });
    }
    this.logger.log(`[auth] step=login_ok userId=${user.id}`);
    if (user.totpEnabled && user.totpSecret) {
      const preAuthToken = await this.issueTwoFactorPreauthToken(
        user.id,
        user.email,
        user.role,
      );
      const twoFactorTtl = this.config.get<string>(
        'JWT_2FA_PREAUTH_EXPIRES',
        '5m',
      );
      this.logger.log(`[auth] step=login_requires_2fa userId=${user.id}`);
      return {
        requiresTwoFactor: true,
        errorCode: AUTH_ERROR_CODES.TWO_FACTOR_REQUIRED,
        preAuthToken,
        expiresIn: twoFactorTtl,
      };
    }
    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.role,
      user.permissions,
    );
    if (localCart?.length) {
      const cart = await this.cartService.mergeLocalCart(user.id, localCart);
      return { ...tokens, cart };
    }
    return tokens;
  }

  async completeLoginWithTwoFactor(
    preAuthToken: string,
    code: string,
    localCart?: LocalCartItemDto[],
  ) {
    let payload: TwoFactorPreauthJwtPayload;
    try {
      payload = await this.jwt.verifyAsync(preAuthToken, {
        secret: this.twoFactorPreauthSecret(),
      });
    } catch {
      throw new BadRequestException(
        'Invalid or expired login session. Sign in again with your email and password.',
      );
    }
    if (
      !payload?.sub ||
      payload.purpose !== TWO_FACTOR_PREAUTH_CLAIM ||
      typeof payload.email !== 'string'
    ) {
      throw new BadRequestException(
        'Invalid or expired login session. Sign in again with your email and password.',
      );
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user.totpEnabled || !user.totpSecret) {
      throw new BadRequestException(
        'Two-factor authentication is not active for this account. Sign in normally.',
      );
    }
    if (!this.totp.verifyCode(code, user.totpSecret)) {
      throw new UnauthorizedException('Invalid authenticator code');
    }
    this.logger.log(`[auth] step=login_2fa_ok userId=${user.id}`);
    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.role,
      user.permissions,
    );
    if (localCart?.length) {
      const cart = await this.cartService.mergeLocalCart(user.id, localCart);
      return { ...tokens, cart };
    }
    return tokens;
  }

  async verifyEmail(token: string, localCart?: LocalCartItemDto[]) {
    let payload: EmailVerifyJwtPayload;
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.emailVerificationSecret(),
      });
    } catch {
      throw new BadRequestException('Invalid or expired verification link');
    }
    if (
      !payload?.sub ||
      typeof payload.sub !== 'string' ||
      payload.purpose !== EMAIL_VERIFY_CLAIM
    ) {
      throw new BadRequestException('Invalid or expired verification link');
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user.emailVerifiedAt) {
      await this.usersService.markEmailVerified(user.id);
      this.logger.log(`[auth] step=email_verified userId=${user.id}`);
    }
    const tokens = await this.issueTokens(
      user.id,
      user.email,
      user.role,
      user.permissions,
    );
    if (localCart?.length) {
      const cart = await this.cartService.mergeLocalCart(user.id, localCart);
      return { ...tokens, cart };
    }
    return tokens;
  }

  /**
   * Same privacy pattern as forgot-password: generic message.
   */
  async resendVerificationEmail(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmailInsensitive(email);
    if (user && !user.emailVerifiedAt) {
      try {
        await this.sendVerificationEmail(user, 'resend');
      } catch (err) {
        this.logger.error(
          `[auth] step=resend_verification_email_failed userId=${user.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    return {
      message:
        'If an account exists and is not yet verified, we sent a confirmation link.',
    };
  }

  async rotateRefresh(
    userId: string,
    email: string,
    role: UserRole,
    permissions?: AdminPermission[],
  ) {
    return this.issueTokens(userId, email, role, permissions);
  }

  /**
   * Always returns the same message (do not reveal whether the email is registered).
   * Sends Resend email when user exists and `RESEND_API_KEY` is set.
   */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmailInsensitive(email);
    if (user) {
      const ttl = this.config.get<string>('PASSWORD_RESET_TOKEN_EXPIRES', '1h');
      const token = await this.signPasswordResetToken(user.id, ttl);
      const baseUrl = this.frontendBaseUrl();
      const resetUrl = `${baseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
      const tpl = this.emailTemplates.passwordReset({
        resetUrl,
        ttlLabel: ttl,
      });
      try {
        await this.notifications.sendEmail({
          to: user.email,
          subject: tpl.subject,
          text: tpl.text,
          html: tpl.html,
        });
      } catch (err) {
        this.logger.error(
          `[auth] step=forgot_password_email_failed userId=${user.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
    return {
      message:
        'If an account exists for that email, we sent a link to reset your password.',
    };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    let payload: PasswordResetJwtPayload;
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.passwordResetSecret(),
      });
    } catch {
      throw new BadRequestException('Invalid or expired reset link');
    }
    if (
      !payload?.sub ||
      typeof payload.sub !== 'string' ||
      payload.purpose !== PASSWORD_RESET_CLAIM
    ) {
      throw new BadRequestException('Invalid or expired reset link');
    }
    const user = await this.usersService.findById(payload.sub);
    await this.usersService.updatePassword(payload.sub, newPassword);
    this.logger.log(`[auth] step=password_reset_ok userId=${payload.sub}`);
    const pwdTpl = this.emailTemplates.passwordChanged();
    try {
      await this.notifications.sendEmail({
        to: user.email,
        subject: pwdTpl.subject,
        text: pwdTpl.text,
        html: pwdTpl.html,
      });
    } catch (err) {
      this.logger.error(
        `[auth] step=password_changed_email_failed userId=${payload.sub}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  private async sendVerificationEmail(
    user: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
    },
    kind: 'initial' | 'resend',
  ): Promise<void> {
    const ttl = this.config.get<string>(
      'EMAIL_VERIFICATION_TOKEN_EXPIRES',
      '48h',
    );
    const secret = this.emailVerificationSecret();
    const token = await this.jwt.signAsync(
      {
        sub: user.id,
        purpose: EMAIL_VERIFY_CLAIM,
      } as EmailVerifyJwtPayload,
      {
        secret,
        expiresIn: ttl as `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`,
      },
    );
    const baseUrl = this.frontendBaseUrl();
    const verifyUrl = `${baseUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
    const tpl =
      kind === 'resend'
        ? this.emailTemplates.resendVerification({
            verifyUrl,
            ttlLabel: ttl,
            displayName,
          })
        : this.emailTemplates.verifyEmail({
            verifyUrl,
            ttlLabel: ttl,
            displayName,
          });
    await this.notifications.sendEmail({
      to: user.email,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
    });
  }

  private async signPasswordResetToken(
    userId: string,
    ttl: string,
  ): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: userId,
        purpose: PASSWORD_RESET_CLAIM,
      } as PasswordResetJwtPayload,
      {
        secret: this.passwordResetSecret(),
        expiresIn: ttl as `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`,
      },
    );
  }

  /**
   * Issues a password-reset-purpose token for a freshly-created admin
   * invite, so the invited admin lands on the existing `/reset-password`
   * flow to set their own password. Returns the token and the TTL label
   * used, so the caller can build the email link and copy.
   */
  async issueAdminInviteToken(
    userId: string,
  ): Promise<{ token: string; ttlLabel: string }> {
    const ttl = this.config.get<string>('PASSWORD_RESET_TOKEN_EXPIRES', '1h');
    const token = await this.signPasswordResetToken(userId, ttl);
    return { token, ttlLabel: ttl };
  }

  private passwordResetSecret(): string {
    const dedicated = this.config.get<string>('JWT_PASSWORD_RESET_SECRET');
    if (dedicated?.trim()) {
      return dedicated.trim();
    }
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  private twoFactorPreauthSecret(): string {
    const dedicated = this.config.get<string>('JWT_2FA_PREAUTH_SECRET');
    if (dedicated?.trim()) {
      return dedicated.trim();
    }
    // Fall back to the refresh secret (not the access secret) so that a
    // pre-auth token is never accepted as a Bearer API token — even on
    // deployments that haven't set JWT_2FA_PREAUTH_SECRET.
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  private async issueTwoFactorPreauthToken(
    userId: string,
    email: string,
    role: UserRole,
  ): Promise<string> {
    const ttl = this.config.get<string>('JWT_2FA_PREAUTH_EXPIRES', '5m');
    return this.jwt.signAsync(
      {
        sub: userId,
        email,
        role,
        purpose: TWO_FACTOR_PREAUTH_CLAIM,
      } as TwoFactorPreauthJwtPayload,
      {
        secret: this.twoFactorPreauthSecret(),
        expiresIn: ttl as `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`,
      },
    );
  }

  private emailVerificationSecret(): string {
    const dedicated = this.config.get<string>('JWT_EMAIL_VERIFICATION_SECRET');
    if (dedicated?.trim()) {
      return dedicated.trim();
    }
    const pwd = this.config.get<string>('JWT_PASSWORD_RESET_SECRET');
    if (pwd?.trim()) {
      return pwd.trim();
    }
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  private frontendBaseUrl(): string {
    const url =
      this.config.get<string>('FRONTEND_URL') ||
      this.config.get<string>('PUBLIC_APP_URL');
    if (url?.trim()) {
      return url.trim();
    }
    return 'http://localhost:3000';
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: UserRole,
    permissions?: AdminPermission[],
  ) {
    const payload: JwtPayload = { sub: userId, email, role, permissions };
    const accessTtl = this.config.get<string>('JWT_ACCESS_EXPIRES', '15m');
    const refreshTtl = this.config.get<string>('JWT_REFRESH_EXPIRES', '7d');
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTtl as `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`,
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl as `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`,
      }),
    ]);
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.usersService.setRefreshTokenHash(userId, refreshTokenHash);
    return { accessToken, refreshToken, expiresIn: accessTtl };
  }
}
