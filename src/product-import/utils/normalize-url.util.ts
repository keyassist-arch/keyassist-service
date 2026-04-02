export function normalizeProductUrl(raw: string): string {
  const trimmed = raw.trim();
  const u = new URL(trimmed);
  u.hash = '';
  return u.href;
}
