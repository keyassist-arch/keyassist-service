/** Truncate long strings for logs (no secrets). */
export function previewText(s: string, max = 80): string {
  const t = s.trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}…`;
}

export function previewUrl(url: string, max = 96): string {
  return previewText(url, max);
}

/** Mask local part of email for operator logs. */
export function maskEmail(email: string): string {
  const i = email.lastIndexOf('@');
  if (i <= 0) {
    return '[redacted]';
  }
  return `***${email.slice(i)}`;
}
