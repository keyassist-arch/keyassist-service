import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend | null;
  /** Resolved once at construction — config is immutable at runtime. */
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.fromAddress = this.resolveResendFrom();
  }

  /**
   * Send a transactional email.
   *
   * @param idempotencyKey - Optional deduplication key (e.g. BullMQ job ID).
   *   Resend honours this header so a retried job doesn't deliver duplicate emails.
   */
  async sendEmail(opts: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    idempotencyKey?: string;
  }): Promise<void> {
    if (!opts.to?.trim()) {
      this.logger.warn(
        `[notify] sendEmail skipped — empty recipient (subject="${opts.subject}")`,
      );
      return;
    }

    if (!this.resend) {
      this.logger.warn(
        `[notify] email skipped (no RESEND_API_KEY): "${opts.subject}" → ${opts.to}`,
      );
      return;
    }

    const { data, error } = await this.resend.emails.send(
      {
        from: this.fromAddress,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html ?? buildHtmlEmail(opts.subject, opts.text),
      },
      opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
    );

    if (error) {
      this.logger.error(
        `[notify] Resend error: ${error.message} (to=${opts.to} subject="${opts.subject}")`,
      );
      // Preserve the Resend error as the cause so callers and BullMQ
      // retry logic see the full chain, not just a re-wrapped message.
      throw Object.assign(new Error(`Email delivery failed: ${error.message}`), {
        cause: error,
      });
    }

    this.logger.log(
      `[notify] email sent id=${data?.id ?? 'n/a'} to=${opts.to} subject="${opts.subject}"`,
    );
  }

  /** SMS is not yet wired to a provider. */
  async sendSms(_to: string, _body: string): Promise<void> {
    this.logger.warn('[notify] SMS channel not configured — message not sent');
  }

  /**
   * Resend requires a verified domain for custom `from` addresses.
   * Use their onboarding sender in dev / when `RESEND_SANDBOX` is set.
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
}

// ---------------------------------------------------------------------------
// HTML email helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Minimal but production-ready HTML email wrapper.
 * Renders the plain-text body inside a clean card layout.
 */
function buildHtmlEmail(subject: string, text: string): string {
  const bodyLines = escapeHtml(text)
    .split('\n')
    .map((l) => (l.trim() === '' ? '<br>' : `<p style="margin:0 0 12px">${l}</p>`))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:540px;background:#ffffff;border-radius:8px;padding:40px;box-shadow:0 1px 4px rgba(0,0,0,.08)" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-bottom:24px;border-bottom:1px solid #e5e7eb">
              <span style="font-size:18px;font-weight:700;color:#111827">Unified Commerce</span>
            </td>
          </tr>
          <tr>
            <td style="padding-top:28px;padding-bottom:28px;color:#374151;font-size:15px;line-height:1.6">
              ${bodyLines}
            </td>
          </tr>
          <tr>
            <td style="padding-top:20px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.5">
              You received this email from Unified Commerce. If you have questions, reply to this email or contact our support team.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
