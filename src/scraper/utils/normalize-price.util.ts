/**
 * First US-style money token in a string: `$999.00` or `$1,399.00`.
 * Use when DOM may concatenate multiple amounts (avoids bogus mega-numbers).
 */
export function parseFirstUsdInString(text: string): string | null {
  const m = text.match(/\$\s*(\d{1,3}(?:,\d{3})*)\.(\d{2})\b/);
  if (m) {
    const whole = m[1].replace(/,/g, '');
    const n = parseFloat(`${whole}.${m[2]}`);
    return Number.isNaN(n) ? null : n.toFixed(2);
  }
  const m2 = text.match(/\$\s*(\d+)\.(\d{2})\b/);
  if (m2) {
    const n = parseFloat(`${m2[1]}.${m2[2]}`);
    return Number.isNaN(n) ? null : n.toFixed(2);
  }
  return null;
}

export function parsePriceToDecimalString(
  price: number | string,
): string | null {
  if (typeof price === 'number' && !Number.isNaN(price)) {
    return price.toFixed(2);
  }
  if (typeof price === 'string') {
    const usd = parseFirstUsdInString(price);
    if (usd) {
      return usd;
    }
    const cleaned = price.replace(/[^\d.,-]/g, '').replace(/,/g, '');
    const n = parseFloat(cleaned);
    if (!Number.isNaN(n)) {
      return n.toFixed(2);
    }
  }
  return null;
}
