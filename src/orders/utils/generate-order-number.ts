import * as crypto from 'crypto';

/**
 * Generates a human-friendly, identifiable order number formatted as `KAO-XXXXXX` (e.g. `KAO-8F29AD`).
 * Option 2: `KAO-` followed by 6 uppercase hexadecimal characters.
 */
export function generateOrderNumber(): string {
  const bytes = crypto.randomBytes(3); // 3 bytes = 6 hex chars
  const hex = bytes.toString('hex').toUpperCase();
  return `KAO-${hex}`;
}
