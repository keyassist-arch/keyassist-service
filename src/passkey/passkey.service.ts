import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import { PasskeyCredential } from './entities/passkey-credential.entity';
import { UsersService } from '../users/users.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { UserRole } from '../common/enums/role.enum';

const REG_CHALLENGE_TTL = 300; // 5 minutes
const AUTH_CHALLENGE_TTL = 300;

@Injectable()
export class PasskeyService {
  private readonly logger = new Logger(PasskeyService.name);

  constructor(
    @InjectRepository(PasskeyCredential)
    private readonly credentials: Repository<PasskeyCredential>,
    private readonly usersService: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  // ── helpers ──────────────────────────────────────────────────────────────

  private rpID(): string {
    const v = this.config.get<string>('PASSKEY_RP_ID')?.trim();
    if (!v) throw new Error('PASSKEY_RP_ID env var is required for passkeys');
    return v;
  }

  private rpName(): string {
    return (
      this.config.get<string>('PASSKEY_RP_NAME')?.trim() || 'Unified Commerce'
    );
  }

  private expectedOrigins(): string[] {
    const raw = this.config.get<string>('PASSKEY_ORIGIN')?.trim() || '';
    if (raw)
      return raw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    const frontend =
      this.config.get<string>('FRONTEND_URL')?.trim() ||
      this.config.get<string>('PUBLIC_APP_URL')?.trim();
    if (frontend) return [frontend.replace(/\/$/, '')];
    return ['http://localhost:3000'];
  }

  private regChallengeKey(userId: string) {
    return `passkey:reg:challenge:${userId}`;
  }

  private authChallengeKey(challenge: string) {
    return `passkey:auth:challenge:${challenge}`;
  }

  private async saveChallenge(key: string, challenge: string, ttl: number) {
    if (!this.redis) {
      throw new BadRequestException(
        'Passkeys require Redis (REDIS_URL) to be configured',
      );
    }
    await this.redis.set(key, challenge, 'EX', ttl);
  }

  private async consumeChallenge(key: string): Promise<string> {
    if (!this.redis) {
      throw new BadRequestException(
        'Passkeys require Redis (REDIS_URL) to be configured',
      );
    }
    const challenge = await this.redis.getdel(key);
    if (!challenge) {
      throw new BadRequestException(
        'Registration or authentication session expired. Please start again.',
      );
    }
    return challenge;
  }

  private async issueTokens(userId: string, email: string, role: UserRole) {
    const accessTtl = this.config.get<string>('JWT_ACCESS_EXPIRES', '15m');
    const refreshTtl = this.config.get<string>('JWT_REFRESH_EXPIRES', '7d');
    const payload = { sub: userId, email, role };
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

  // ── registration ─────────────────────────────────────────────────────────

  async startRegistration(userId: string) {
    const user = await this.usersService.findById(userId);

    const existing = await this.credentials.find({ where: { userId } });
    const excludeCredentials = existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransport[],
    }));

    const options = await generateRegistrationOptions({
      rpName: this.rpName(),
      rpID: this.rpID(),
      userName: user.email,
      userDisplayName:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
      userID: isoUint8Array.fromUTF8String(userId),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      excludeCredentials,
    });

    await this.saveChallenge(
      this.regChallengeKey(userId),
      options.challenge,
      REG_CHALLENGE_TTL,
    );

    this.logger.log(`[passkey] step=reg_options_generated userId=${userId}`);
    return options;
  }

  async finishRegistration(
    userId: string,
    body: RegistrationResponseJSON,
    friendlyName?: string,
  ) {
    const expectedChallenge = await this.consumeChallenge(
      this.regChallengeKey(userId),
    );

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: this.expectedOrigins(),
        expectedRPID: this.rpID(),
        requireUserVerification: false,
      });
    } catch (err) {
      this.logger.warn(
        `[passkey] step=reg_verify_failed userId=${userId} err=${(err as Error).message}`,
      );
      throw new BadRequestException('Passkey registration verification failed');
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException(
        'Passkey registration could not be verified',
      );
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    const credentialId = credential.id;
    const publicKeyB64 = isoBase64URL.fromBuffer(credential.publicKey);

    const existing = await this.credentials.findOne({
      where: { credentialId },
    });
    if (existing) {
      throw new BadRequestException('This passkey is already registered');
    }

    const cred = this.credentials.create({
      userId,
      credentialId,
      publicKey: publicKeyB64,
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports ?? [],
      friendlyName: friendlyName?.trim() || null,
    });

    await this.credentials.save(cred);
    this.logger.log(
      `[passkey] step=reg_ok userId=${userId} credentialId=${credentialId}`,
    );

    return { verified: true, credentialId };
  }

  // ── authentication ────────────────────────────────────────────────────────

  async startAuthentication() {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID(),
      userVerification: 'preferred',
      // Empty allowCredentials = discoverable / resident-key flow (usernameless)
    });

    await this.saveChallenge(
      this.authChallengeKey(options.challenge),
      options.challenge,
      AUTH_CHALLENGE_TTL,
    );

    this.logger.log('[passkey] step=auth_options_generated');
    return options;
  }

  private extractChallenge(clientDataJSON: string): string {
    try {
      const json = JSON.parse(
        Buffer.from(clientDataJSON, 'base64url').toString('utf8'),
      ) as { challenge?: string };
      return json.challenge ?? '';
    } catch {
      return '';
    }
  }

  async finishAuthentication(body: AuthenticationResponseJSON) {
    const credentialId = body.id;
    const stored = await this.credentials.findOne({ where: { credentialId } });
    if (!stored) {
      throw new UnauthorizedException('Passkey not found');
    }

    const challengeFromClient = this.extractChallenge(
      body.response.clientDataJSON,
    );
    const expectedChallenge = await this.consumeChallenge(
      this.authChallengeKey(challengeFromClient),
    );

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: this.expectedOrigins(),
        expectedRPID: this.rpID(),
        credential: {
          id: stored.credentialId,
          publicKey: isoBase64URL.toBuffer(stored.publicKey),
          counter: stored.counter,
          transports: stored.transports as AuthenticatorTransport[],
        },
        requireUserVerification: false,
      });
    } catch (err) {
      this.logger.warn(
        `[passkey] step=auth_verify_failed credentialId=${credentialId} err=${(err as Error).message}`,
      );
      throw new UnauthorizedException('Passkey authentication failed');
    }

    if (!verification.verified) {
      throw new UnauthorizedException('Passkey authentication failed');
    }

    // Update counter to prevent replay attacks
    await this.credentials.update(stored.id, {
      counter: verification.authenticationInfo.newCounter,
    });

    const user = await this.usersService.findById(stored.userId);
    this.logger.log(
      `[passkey] step=auth_ok userId=${user.id} credentialId=${credentialId}`,
    );

    return this.issueTokens(user.id, user.email, user.role);
  }

  // ── credential management ─────────────────────────────────────────────────

  async listCredentials(userId: string) {
    const creds = await this.credentials.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return creds.map(
      ({
        id,
        credentialId,
        deviceType,
        backedUp,
        transports,
        friendlyName,
        createdAt,
      }) => ({
        id,
        credentialId,
        deviceType,
        backedUp,
        transports,
        friendlyName,
        createdAt,
      }),
    );
  }

  async removeCredential(userId: string, id: string) {
    const cred = await this.credentials.findOne({ where: { id, userId } });
    if (!cred) throw new NotFoundException('Credential not found');
    await this.credentials.remove(cred);
  }

  async renameCredential(userId: string, id: string, friendlyName: string) {
    const cred = await this.credentials.findOne({ where: { id, userId } });
    if (!cred) throw new NotFoundException('Credential not found');
    await this.credentials.update(id, {
      friendlyName: friendlyName.trim() || null,
    });
    return { id, friendlyName: friendlyName.trim() || null };
  }
}
