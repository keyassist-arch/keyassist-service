import { Injectable } from '@nestjs/common';

export interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function btn(href: string, label: string, color = '#111827'): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">` +
    `<tr><td style="border-radius:8px;background:${color};">` +
    `<a href="${esc(href)}" style="display:inline-block;padding:13px 28px;` +
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;` +
    `font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;` +
    `border-radius:8px;line-height:1;">${esc(label)}</a>` +
    `</td></tr></table>`
  );
}

function fallbackLink(url: string): string {
  return (
    `<p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">` +
    `If the button doesn't work, copy and paste this link into your browser:<br>` +
    `<span style="word-break:break-all;color:#2563eb;">${esc(url)}</span></p>`
  );
}

function infoRow(label: string, value: string): string {
  return (
    `<tr>` +
    `<td style="padding:10px 0;font-size:14px;color:#6b7280;border-bottom:1px solid #f3f4f6;` +
    `width:40%;vertical-align:top;">${esc(label)}</td>` +
    `<td style="padding:10px 0 10px 16px;font-size:14px;color:#111827;border-bottom:1px solid #f3f4f6;` +
    `font-weight:500;vertical-align:top;">${esc(value)}</td>` +
    `</tr>`
  );
}

function infoTable(rows: [string, string][]): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="margin:24px 0;border-collapse:collapse;">` +
    rows.map(([l, v]) => infoRow(l, v)).join('') +
    `</table>`
  );
}

function layout(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  footerNote?: string;
}): string {
  const footer = opts.footerNote
    ? `<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">${esc(opts.footerNote)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${esc(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;-webkit-font-smoothing:antialiased;">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
    <tr><td align="center">

      <!-- Header -->
      <table role="presentation" width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:0 0 20px;">
            <a href="#" style="text-decoration:none;">
              <span style="font-size:22px;font-weight:800;color:#111827;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                Key<span style="color:#2563eb;">Assist</span>
              </span>
            </a>
          </td>
        </tr>
      </table>

      <!-- Card -->
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 4px 16px rgba(0,0,0,0.04);overflow:hidden;" cellpadding="0" cellspacing="0">

        <!-- Card body -->
        <tr>
          <td style="padding:36px 40px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">${esc(opts.heading)}</h1>
            <div style="font-size:15px;line-height:1.65;color:#374151;">
              ${opts.bodyHtml}
            </div>
          </td>
        </tr>

        <!-- Footer strip -->
        <tr>
          <td style="padding:20px 40px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
              This email was sent by <strong style="color:#6b7280;">KeyAssist</strong>. If you have questions, reply to this email or reach our support team.
            </p>
            ${footer}
          </td>
        </tr>

      </table>

      <!-- Bottom spacer -->
      <table role="presentation" width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;font-size:11px;color:#9ca3af;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            &copy; ${new Date().getFullYear()} KeyAssist. All rights reserved.
          </p>
        </td></tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class EmailTemplateService {
  // ── Auth ──────────────────────────────────────────────────────────────────

  verifyEmail(args: {
    verifyUrl: string;
    ttlLabel: string;
    displayName?: string | null;
    subject?: string;
  }): EmailTemplate {
    const name = args.displayName?.trim();
    const greeting = name ? `Hi ${name},` : 'Hi there,';
    const subject = args.subject?.trim() || 'Verify your KeyAssist account';

    const text =
      `${greeting}\n\n` +
      `Thanks for signing up for KeyAssist. Please confirm your email address to activate your account.\n\n` +
      `Verify here (link expires in ${args.ttlLabel}):\n${args.verifyUrl}\n\n` +
      `If you didn't create an account with us, you can safely ignore this email.`;

    const bodyHtml =
      `<p style="margin:0 0 16px;">${esc(greeting)}</p>` +
      `<p style="margin:0 0 16px;">Thanks for signing up for KeyAssist. Please confirm your email address to activate your account.</p>` +
      btn(args.verifyUrl, 'Verify email address') +
      `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">This link expires in <strong style="color:#374151;">${esc(args.ttlLabel)}</strong>.</p>` +
      fallbackLink(args.verifyUrl);

    return {
      subject,
      text,
      html: layout({
        preheader: 'Confirm your email to start using KeyAssist.',
        heading: 'Verify your email address',
        bodyHtml,
        footerNote: "If you didn't create an account, you can ignore this email.",
      }),
    };
  }

  resendVerification(args: {
    verifyUrl: string;
    ttlLabel: string;
    displayName?: string | null;
  }): EmailTemplate {
    return this.verifyEmail({ ...args, subject: 'Confirm your email — KeyAssist' });
  }

  passwordReset(args: { resetUrl: string; ttlLabel: string }): EmailTemplate {
    const subject = 'Reset your KeyAssist password';

    const text =
      `We received a request to reset the password on your KeyAssist account.\n\n` +
      `Reset your password here (link expires in ${args.ttlLabel}):\n${args.resetUrl}\n\n` +
      `If you didn't request this, you can safely ignore this email — your password won't change.`;

    const bodyHtml =
      `<p style="margin:0 0 16px;">We received a request to reset the password on your KeyAssist account.</p>` +
      btn(args.resetUrl, 'Reset password') +
      `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">This link expires in <strong style="color:#374151;">${esc(args.ttlLabel)}</strong>. For security, it can only be used once.</p>` +
      fallbackLink(args.resetUrl);

    return {
      subject,
      text,
      html: layout({
        preheader: 'Use this link to choose a new password.',
        heading: 'Reset your password',
        bodyHtml,
        footerNote: "If you didn't request a password reset, you can ignore this email.",
      }),
    };
  }

  passwordChanged(): EmailTemplate {
    const subject = 'Your KeyAssist password was changed';

    const text =
      `The password on your KeyAssist account was just updated.\n\n` +
      `If this was you, no action is needed.\n\n` +
      `If you didn't make this change, please reset your password immediately using "Forgot password" on the sign-in page, then contact our support team.`;

    const bodyHtml =
      `<p style="margin:0 0 16px;">The password on your KeyAssist account was just updated.</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;width:100%;">` +
      `<tr><td style="padding:14px 18px;font-size:14px;color:#15803d;">&#10003;&nbsp; If this was you, no action is needed.</td></tr></table>` +
      `<p style="margin:0;font-size:13px;color:#6b7280;">` +
      `If you didn't make this change, use <strong>Forgot password</strong> on the sign-in page immediately and contact our support team for help securing your account.` +
      `</p>`;

    return {
      subject,
      text,
      html: layout({
        preheader: 'Your account password was updated.',
        heading: 'Password changed',
        bodyHtml,
      }),
    };
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  orderConfirmation(args: {
    orderId: string;
    currency: string;
    total: string | number;
    displayName?: string | null;
  }): EmailTemplate {
    const name = args.displayName?.trim();
    const greeting = name ? `Hi ${name},` : 'Hi there,';
    const subject = `Order confirmed — #${args.orderId.slice(0, 8).toUpperCase()}`;
    const totalDisplay = `${args.currency} ${args.total}`;

    const text =
      `${greeting}\n\n` +
      `We've received your order and it's being reviewed.\n\n` +
      `Order ID: ${args.orderId}\n` +
      `Total: ${totalDisplay}\n\n` +
      `To complete your purchase, please proceed with payment. You'll receive another email once your payment is confirmed.\n\n` +
      `Thank you for shopping with KeyAssist.`;

    const bodyHtml =
      `<p style="margin:0 0 16px;">${esc(greeting)}</p>` +
      `<p style="margin:0 0 20px;">We've received your order and it's being reviewed. Please complete your payment to proceed.</p>` +
      infoTable([
        ['Order ID', args.orderId],
        ['Order total', totalDisplay],
        ['Status', 'Awaiting payment'],
      ]) +
      `<p style="margin:0;font-size:13px;color:#6b7280;">You'll receive another email as soon as your payment is confirmed. Thank you for shopping with KeyAssist.</p>`;

    return {
      subject,
      text,
      html: layout({
        preheader: `Your KeyAssist order #${args.orderId.slice(0, 8).toUpperCase()} has been received.`,
        heading: 'Order received',
        bodyHtml,
      }),
    };
  }

  paymentConfirmed(args: {
    orderId: string;
    currency: string;
    total: string | number;
    displayName?: string | null;
  }): EmailTemplate {
    const name = args.displayName?.trim();
    const greeting = name ? `Hi ${name},` : 'Hi there,';
    const subject = `Payment confirmed — #${args.orderId.slice(0, 8).toUpperCase()}`;
    const totalDisplay = `${args.currency} ${args.total}`;

    const text =
      `${greeting}\n\n` +
      `Great news — your payment has been confirmed and we're now processing your order.\n\n` +
      `Order ID: ${args.orderId}\n` +
      `Amount paid: ${totalDisplay}\n\n` +
      `We'll send you a tracking update as soon as your order ships.\n\n` +
      `Thank you for shopping with KeyAssist.`;

    const bodyHtml =
      `<p style="margin:0 0 16px;">${esc(greeting)}</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;width:100%;">` +
      `<tr><td style="padding:14px 18px;font-size:15px;font-weight:600;color:#15803d;">&#10003;&nbsp; Payment confirmed</td></tr></table>` +
      `<p style="margin:0 0 20px;">Great news — your payment has been received and we're now processing your order.</p>` +
      infoTable([
        ['Order ID', args.orderId],
        ['Amount paid', totalDisplay],
        ['Status', 'Processing'],
      ]) +
      `<p style="margin:0;font-size:13px;color:#6b7280;">We'll send you a tracking update as soon as your order ships. Thank you for shopping with KeyAssist.</p>`;

    return {
      subject,
      text,
      html: layout({
        preheader: `Your payment of ${totalDisplay} has been confirmed.`,
        heading: 'Payment confirmed',
        bodyHtml,
      }),
    };
  }

  // ── Shipping ──────────────────────────────────────────────────────────────

  shipmentUpdate(args: {
    orderId: string;
    status?: string | null;
    trackingNumber?: string | null;
    carrier?: string | null;
    displayName?: string | null;
  }): EmailTemplate {
    const name = args.displayName?.trim();
    const greeting = name ? `Hi ${name},` : 'Hi there,';
    const subject = `Update on your order #${args.orderId.slice(0, 8).toUpperCase()}`;

    const lines: string[] = [];
    if (args.status) lines.push(`Status: ${args.status}`);
    if (args.trackingNumber) {
      const carrierPart = args.carrier ? `${args.carrier} — ` : '';
      lines.push(`Tracking: ${carrierPart}${args.trackingNumber}`);
    }

    const text =
      `${greeting}\n\n` +
      `There's an update on your KeyAssist order.\n\n` +
      `Order ID: ${args.orderId}\n` +
      lines.join('\n') +
      `\n\nIf you have any questions about your order, please reply to this email.`;

    const infoRows: [string, string][] = [['Order ID', args.orderId]];
    if (args.status) infoRows.push(['Status', args.status]);
    if (args.trackingNumber) {
      const carrierPart = args.carrier ? `${args.carrier} — ` : '';
      infoRows.push(['Tracking', `${carrierPart}${args.trackingNumber}`]);
    }

    const bodyHtml =
      `<p style="margin:0 0 16px;">${esc(greeting)}</p>` +
      `<p style="margin:0 0 20px;">There's an update on your KeyAssist order.</p>` +
      infoTable(infoRows) +
      `<p style="margin:0;font-size:13px;color:#6b7280;">If you have any questions about your shipment, simply reply to this email and our team will help you out.</p>`;

    return {
      subject,
      text,
      html: layout({
        preheader: `Your order #${args.orderId.slice(0, 8).toUpperCase()} has a new update.`,
        heading: 'Order update',
        bodyHtml,
      }),
    };
  }

  // ── Reconciliation ────────────────────────────────────────────────────────

  refundInitiated(args: {
    orderId: string;
    currency: string;
    amount: string | number;
    reason?: string | null;
    displayName?: string | null;
  }): EmailTemplate {
    const name = args.displayName?.trim();
    const greeting = name ? `Hi ${name},` : 'Hi there,';
    const subject = `Refund initiated — #${args.orderId.slice(0, 8).toUpperCase()}`;
    const amountDisplay = `${args.currency} ${typeof args.amount === 'number' ? args.amount.toFixed(2) : args.amount}`;

    const reasonLine = args.reason
      ? `\nReason: ${args.reason}`
      : '';

    const text =
      `${greeting}\n\n` +
      `We've initiated a refund for your KeyAssist order.\n\n` +
      `Order ID: ${args.orderId}\n` +
      `Refund amount: ${amountDisplay}${reasonLine}\n\n` +
      `Please allow 3–10 business days for the funds to appear on your original payment method.\n\n` +
      `If you have questions, reply to this email and our support team will assist you.`;

    const infoRows: [string, string][] = [
      ['Order ID', args.orderId],
      ['Refund amount', amountDisplay],
    ];
    if (args.reason) infoRows.push(['Reason', args.reason]);
    infoRows.push(['Timeline', '3–10 business days']);

    const bodyHtml =
      `<p style="margin:0 0 16px;">${esc(greeting)}</p>` +
      `<p style="margin:0 0 20px;">We've initiated a refund for your order. Here are the details:</p>` +
      infoTable(infoRows) +
      `<p style="margin:0 0 12px;font-size:13px;color:#6b7280;">` +
      `The refund will appear on your original payment method within <strong style="color:#374151;">3–10 business days</strong>, depending on your bank or card provider.` +
      `</p>` +
      `<p style="margin:0;font-size:13px;color:#6b7280;">If you have any questions, simply reply to this email and our support team will be happy to help.</p>`;

    return {
      subject,
      text,
      html: layout({
        preheader: `A refund of ${amountDisplay} has been initiated for your order.`,
        heading: 'Refund initiated',
        bodyHtml,
      }),
    };
  }
}
