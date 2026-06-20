import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, ShippingAddress } from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { TotpService } from '../totp/totp.service';

/** PostgreSQL unique-constraint violation code. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly totp: TotpService,
  ) {}

  async create(
    firstName: string,
    lastName: string,
    email: string,
    password: string,
    phone?: string,
  ): Promise<User> {
    // Normalize email to lowercase so the DB unique index and
    // findByEmailInsensitive always agree — prevents case-variant duplicates.
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.users.findOne({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = this.users.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      passwordHash,
      phone: phone ?? null,
    });
    try {
      return await this.users.save(user);
    } catch (err: unknown) {
      // Race condition: two concurrent requests both passed the findOne check.
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException('Email already registered');
      }
      throw err;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email } });
  }

  /** Case-insensitive match (for login hints / password reset). */
  async findByEmailInsensitive(email: string): Promise<User | null> {
    const trimmed = email.trim();
    return this.users
      .createQueryBuilder('u')
      .where('LOWER(u.email) = LOWER(:email)', { email: trimmed })
      .getOne();
  }

  async findById(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async setRefreshTokenHash(
    userId: string,
    hash: string | null,
  ): Promise<void> {
    await this.users.update(userId, { refreshTokenHash: hash });
  }

  async setStripeCustomerId(userId: string, customerId: string): Promise<void> {
    await this.users.update(userId, { stripeCustomerId: customerId });
  }

  async updatePassword(userId: string, plainPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    await this.users.update(userId, {
      passwordHash,
      refreshTokenHash: null,
    });
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.users.update(userId, { emailVerifiedAt: new Date() });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<User> {
    const user = await this.findById(userId);
    if (dto.firstName !== undefined) {
      user.firstName = dto.firstName.trim();
    }
    if (dto.lastName !== undefined) {
      user.lastName = dto.lastName.trim();
    }
    if (dto.phone !== undefined) user.phone = dto.phone;
    if (dto.defaultShippingAddress !== undefined) {
      user.defaultShippingAddress =
        dto.defaultShippingAddress as ShippingAddress;
    }
    return this.users.save(user);
  }

  toPublic(user: User) {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      emailVerified: !!user.emailVerifiedAt,
      phone: user.phone,
      defaultShippingAddress: user.defaultShippingAddress,
      twoFactor: {
        enabled: user.totpEnabled,
        setupPending: Boolean(!user.totpEnabled && user.totpSetupSecret),
      },
      role: user.role,
      createdAt: user.createdAt,
    };
  }

  async setTotpSetupSecret(
    userId: string,
    secret: string | null,
  ): Promise<void> {
    await this.users.update(userId, { totpSetupSecret: secret });
  }

  async enableTotpFromPendingSetup(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user.totpSetupSecret) {
      throw new BadRequestException('No 2FA setup in progress');
    }
    await this.users.update(userId, {
      totpSecret: user.totpSetupSecret,
      totpSetupSecret: null,
      totpEnabled: true,
    });
  }

  async clearTotpSetup(userId: string): Promise<void> {
    await this.users.update(userId, { totpSetupSecret: null });
  }

  async disableTotpAndSecrets(userId: string): Promise<void> {
    await this.users.update(userId, {
      totpEnabled: false,
      totpSecret: null,
      totpSetupSecret: null,
    });
  }

  async beginTotpSetup(userId: string) {
    const user = await this.findById(userId);
    if (user.totpEnabled) {
      throw new BadRequestException(
        'Two-factor authentication is already enabled. Disable it before enrolling a new device.',
      );
    }
    const secret = this.totp.generateSecret();
    await this.setTotpSetupSecret(userId, secret);
    const otpauthUrl = this.totp.keyUri(user.email, secret);
    const qrCodeDataUrl = await this.totp.toQrDataUrl(otpauthUrl);
    return {
      issuer: this.totp.issuerName(),
      otpauthUrl,
      qrCodeDataUrl,
      /** For manual entry in an authenticator app */
      secret,
    };
  }

  async confirmTotpSetup(userId: string, code: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user.totpSetupSecret) {
      throw new BadRequestException(
        'No 2FA setup in progress. Start setup first.',
      );
    }
    if (!this.totp.verifyCode(code, user.totpSetupSecret)) {
      throw new BadRequestException('Invalid authenticator code');
    }
    await this.enableTotpFromPendingSetup(userId);
  }

  async cancelTotpSetup(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user.totpSetupSecret) {
      throw new BadRequestException('No 2FA setup in progress');
    }
    if (user.totpEnabled) {
      throw new BadRequestException('Use "disable" to turn off 2FA');
    }
    await this.clearTotpSetup(userId);
  }

  /**
   * Disables 2FA after password (and TOTP) verification; revokes refresh tokens.
   */
  twoFactorSummary(user: User) {
    return {
      enabled: user.totpEnabled,
      setupPending: Boolean(!user.totpEnabled && user.totpSetupSecret),
    };
  }

  async disableTotp(
    userId: string,
    password: string,
    authenticatorCode: string,
  ): Promise<void> {
    const user = await this.findById(userId);
    if (!user.totpEnabled || !user.totpSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid password');
    }
    if (!this.totp.verifyCode(authenticatorCode, user.totpSecret)) {
      throw new BadRequestException('Invalid authenticator code');
    }
    await this.disableTotpAndSecrets(userId);
    await this.setRefreshTokenHash(userId, null);
  }
}
