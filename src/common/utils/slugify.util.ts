/** URL-safe slug from a product title (ASCII, hyphens, max length). */
export function slugifyTitle(title: string, maxLen = 180): string {
  const s = title
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
  return s || 'product';
}
