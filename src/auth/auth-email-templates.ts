/**
 * HTML + plain-text bodies for authentication emails (MailerSend).
 * Keep copy neutral; links use FRONTEND_URL-derived URLs from the caller.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s);
}

function layoutHtml(opts: {
  title: string;
  preheader: string;
  bodyHtml: string;
  footerLines: string[];
}): string {
  const foot = opts.footerLines
    .map(
      (l) =>
        `<p style="margin:8px 0 0;font-size:12px;color:#64748b;">${escapeHtml(l)}</p>`,
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;background:#f1f5f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;">${escapeHtml(opts.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;box-shadow:0 4px 24px rgba(15,23,42,0.08);overflow:hidden;">
        <tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:700;color:#0f172a;">${escapeHtml(opts.title)}</td></tr>
        <tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.55;color:#334155;">${opts.bodyHtml}</td></tr>
        <tr><td style="padding:0 28px 24px;border-top:1px solid #e2e8f0;">${foot}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Unified Commerce</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function primaryButton(href: string, label: string): string {
  return `<a href="${escapeHtmlAttr(href)}" style="display:inline-block;margin:16px 0;padding:12px 22px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">${escapeHtml(label)}</a>`;
}

export const authEmailTemplates = {
  verifyEmail(args: {
    verifyUrl: string;
    ttlLabel: string;
    displayName?: string | null;
    /** Default: "Verify your email" */
    subject?: string;
  }) {
    const name = args.displayName?.trim();
    const greeting = name ? `Hi ${name},` : 'Hi,';
    const subject = args.subject?.trim() || 'Verify your email';
    const text =
      `${greeting}\n\n` +
      `Please confirm your email address for your Unified Commerce account.\n\n` +
      `Open this link (valid for ${args.ttlLabel}):\n${args.verifyUrl}\n\n` +
      `If you did not create an account, you can ignore this email.`;
    const bodyHtml =
      `<p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>` +
      `<p style="margin:0 0 12px;">Please confirm your email address for your Unified Commerce account.</p>` +
      `<p style="margin:0;">${primaryButton(args.verifyUrl, 'Verify email')}</p>` +
      `<p style="margin:16px 0 0;font-size:13px;color:#64748b;">This link expires in <strong>${escapeHtml(args.ttlLabel)}</strong>.</p>` +
      `<p style="margin:16px 0 0;font-size:13px;color:#64748b;">If the button does not work, paste this URL into your browser:<br/><span style="word-break:break-all;">${escapeHtml(args.verifyUrl)}</span></p>`;
    const html = layoutHtml({
      title: subject,
      preheader: 'Confirm your email to finish setting up your account.',
      bodyHtml,
      footerLines: [
        'If you did not create an account, you can ignore this email.',
      ],
    });
    return { subject, text, html };
  },

  passwordReset(args: { resetUrl: string; ttlLabel: string }) {
    const subject = 'Reset your password';
    const text =
      `We received a request to reset the password for your account.\n\n` +
      `Open this link (valid for ${args.ttlLabel}):\n${args.resetUrl}\n\n` +
      `If you did not request this, you can ignore this email.`;
    const bodyHtml =
      `<p style="margin:0 0 12px;">We received a request to reset the password for your account.</p>` +
      `<p style="margin:0;">${primaryButton(args.resetUrl, 'Reset password')}</p>` +
      `<p style="margin:16px 0 0;font-size:13px;color:#64748b;">This link expires in <strong>${escapeHtml(args.ttlLabel)}</strong>.</p>` +
      `<p style="margin:16px 0 0;font-size:13px;color:#64748b;">If the button does not work, paste this URL into your browser:<br/><span style="word-break:break-all;">${escapeHtml(args.resetUrl)}</span></p>`;
    const html = layoutHtml({
      title: subject,
      preheader: 'Use this link to choose a new password.',
      bodyHtml,
      footerLines: ['If you did not request this, you can ignore this email.'],
    });
    return { subject, text, html };
  },

  passwordChanged() {
    const subject = 'Your password was changed';
    const text =
      `The password for your Unified Commerce account was just changed.\n\n` +
      `If this was you, no action is needed.\n\n` +
      `If you did not make this change, reset your password immediately using “Forgot password” on the sign-in page and contact support if you need help.`;
    const bodyHtml =
      `<p style="margin:0 0 12px;">The password for your Unified Commerce account was just changed.</p>` +
      `<p style="margin:0 0 12px;">If this was you, no action is needed.</p>` +
      `<p style="margin:0;font-size:13px;color:#64748b;">If you did not make this change, use <strong>Forgot password</strong> on the sign-in page and contact support if you need help.</p>`;
    const html = layoutHtml({
      title: subject,
      preheader: 'Your account password was updated.',
      bodyHtml,
      footerLines: [],
    });
    return { subject, text, html };
  },

  resendVerification(args: {
    verifyUrl: string;
    ttlLabel: string;
    displayName?: string | null;
  }) {
    return authEmailTemplates.verifyEmail({
      ...args,
      subject: 'Confirm your email',
    });
  },
};
