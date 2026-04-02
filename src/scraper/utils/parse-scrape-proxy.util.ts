import type { BrowserContextOptions } from 'playwright';

/**
 * Parse `SCRAPE_PROXY` (e.g. http://user:pass@host:port) for Playwright `browser.newContext({ proxy })`.
 */
export function parseScrapeProxy(
  raw: string | undefined,
): BrowserContextOptions['proxy'] {
  const s = raw?.trim();
  if (!s) {
    return undefined;
  }
  try {
    const u = new URL(s);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    const server = `${u.protocol}//${u.hostname}:${port}`;
    const username = u.username ? decodeURIComponent(u.username) : undefined;
    const password = u.password ? decodeURIComponent(u.password) : undefined;
    return {
      server,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    };
  } catch {
    return { server: s };
  }
}
