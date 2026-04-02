import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendEmail(opts: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `Email skipped (no RESEND_API_KEY): ${opts.subject} → ${opts.to}`,
      );
      return;
    }
    const from = this.resolveResendFrom();
    const { data, error } = await this.resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html ?? `<pre>${escapeHtml(opts.text)}</pre>`,
    });
    if (error) {
      this.logger.error(
        `Resend failed: ${error.message} (to=${opts.to}, subject=${opts.subject})`,
      );
      throw new Error(error.message);
    }
    this.logger.debug(`Email sent id=${data?.id ?? 'n/a'} → ${opts.to}`);
  }

  /**
   * Resend requires a verified domain for custom `from` addresses.
   * Use their onboarding sender (no domain) in dev / when `RESEND_SANDBOX` is true.
   */
  private resolveResendFrom(): string {
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    const explicit = this.config.get<string>('RESEND_SANDBOX')?.trim().toLowerCase();
    let useOnboarding: boolean;
    if (explicit === 'true' || explicit === '1') {
      useOnboarding = true;
    } else if (explicit === 'false' || explicit === '0') {
      useOnboarding = false;
    } else {
      useOnboarding = nodeEnv !== 'production';
    }
    if (useOnboarding) {
      return 'Unified Commerce <onboarding@resend.dev>';
    }
    return (
      this.config.get<string>('RESEND_FROM')?.trim() ||
      this.config.get<string>('MAIL_FROM')?.trim() ||
      'Unified Commerce <onboarding@resend.dev>'
    );
  }

  async sendSms(_to: string, _body: string): Promise<void> {
    this.logger.warn('SMS channel not configured');
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
