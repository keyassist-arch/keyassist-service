import type { BrowserContextOptions } from 'playwright';

/**
 * Parse `SCRAPE_PROXY` (e.g. http://user:pass@host:port) for Playwright `browser.newContext({ proxy })`.
 */
export function parseScrapeProxy(
  raw: string | undefined,
  geoCode?: string,
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
    let password = u.password ? decodeURIComponent(u.password) : undefined;
    const normalizedGeo = geoCode?.trim().toLowerCase();
    const isScrapeDo = /(^|\.)scrape\.do$/i.test(u.hostname);
    if (isScrapeDo && normalizedGeo) {
      const params = new URLSearchParams(password ?? '');
      params.set('geoCode', normalizedGeo);
      password = params.toString();
    }
    return {
      server,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    };
  } catch {
    return { server: s };
  }
}
