import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';

@Injectable()
export class TotpService {
  constructor(private readonly config: ConfigService) {}

  issuerName(): string {
    return (
      this.config.get<string>('TOTP_ISSUER_NAME')?.trim() || 'Unified Commerce'
    );
  }

  generateSecret(): string {
    return generateSecret();
  }

  verifyCode(token: string, secret: string): boolean {
    const normalized = token.replace(/\s/g, '');
    if (!/^\d{4,8}$/.test(normalized)) {
      return false;
    }
    try {
      return verifySync({ token: normalized, secret }).valid;
    } catch {
      return false;
    }
  }

  /**
   * otpauth:// URI for authenticator apps.
   *
   * Label format is `issuer:email` per the Google Authenticator Key URI spec
   * (https://github.com/google/google-authenticator/wiki/Key-Uri-Format).
   * Including the issuer prefix in the label ensures the entry is grouped and
   * named correctly in apps like Google Authenticator, Authy, and 1Password.
   */
  keyUri(email: string, secret: string): string {
    const issuer = this.issuerName();
    return generateURI({
      issuer,
      label: `${issuer}:${email}`,
      secret,
    });
  }

  async toQrDataUrl(otpauthUrl: string): Promise<string> {
    return QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  }
}
