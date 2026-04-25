/**
 * Query parameters that carry no product information — only analytics / referral attribution.
 * Stripping them ensures the same product imported from different marketing links deduplicates
 * to a single `ImportedProduct` row.
 */
const TRACKING_PARAMS = new Set([
  // UTM
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  // Common referral / click tokens
  'ref',
  'referrer',
  'source',
  'fbclid',
  'gclid',
  'msclkid',
  'igshid',
  'twclid',
  'ttclid',
  'li_fat_id',
  // Mailchimp
  'mc_cid',
  'mc_eid',
  // Google Analytics
  '_ga',
  '_gl',
  // Affiliate / impact
  'irclickid',
  'irgwc',
  'affid',
  'clickid',
]);

export function normalizeProductUrl(raw: string): string {
  const u = new URL(raw.trim());
  // Fragments are never sent to the server.
  u.hash = '';
  // Strip tracking-only params that don't affect which product is shown.
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      u.searchParams.delete(key);
    }
  }
  return u.href;
}
