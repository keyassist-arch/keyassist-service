import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import * as http from 'http';

/**
 * scrape.do occasionally proxies back a response with a very large combined
 * Set-Cookie header (seen on Back Market product pages), which exceeds
 * Node's default ~16KB HTTP header limit and makes axios/undici throw
 * "Parse Error: Header overflow" / UND_ERR_HEADERS_OVERFLOW before we ever
 * see a status code. Route requests through a plain `http` transport with a
 * bumped `maxHeaderSize` to avoid that.
 */
const scrapeDoTransport = {
  request: (
    options: http.RequestOptions,
    callback?: (res: import('http').IncomingMessage) => void,
  ) => http.request({ ...options, maxHeaderSize: 262_144 }, callback),
};

export function buildScrapeDoUrl(
  token: string,
  targetUrl: string,
  extraParams: Record<string, string> = {},
): string {
  const params = new URLSearchParams({ token, url: targetUrl, ...extraParams });
  return `http://api.scrape.do/?${params.toString()}`;
}

/** GET a URL through scrape.do with the header-overflow-safe transport. */
export async function scrapeDoGet<T = string>(
  token: string,
  targetUrl: string,
  extraParams: Record<string, string> = {},
  axiosConfig: AxiosRequestConfig = {},
): Promise<AxiosResponse<T>> {
  return axios.get<T>(buildScrapeDoUrl(token, targetUrl, extraParams), {
    timeout: 60_000,
    maxContentLength: 10_000_000,
    headers: { Accept: 'text/html' },
    validateStatus: (s) => s >= 200 && s < 400,
    ...axiosConfig,
    transport: scrapeDoTransport,
  });
}
