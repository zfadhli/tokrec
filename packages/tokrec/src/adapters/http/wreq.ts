/**
 * HTTP client — thin wrapper around wreq-js createSession.
 * Provides TLS fingerprint impersonation, cookie jar, proxy support,
 * and configurable rate limiting to prevent WAF triggering.
 *
 * This file owns the `HttpClient` contract: it is the seam every adapter and
 * `test/utils/mock-http.ts` implement. There is no second definition.
 */

import { createSession, type Session } from "wreq-js"
import type { RecorderConfig } from "../../lib/config"
import { createRateLimiter } from "./rate-limit"

// BodyInit is only available inside declare module "bun" in bun-types, not as a global
// under the ES2022 lib. We explicitly import it to keep lib focused on ES2022.
export type HttpBody = import("bun").BodyInit

export interface HttpClient {
  get: (url: string, signal?: AbortSignal) => Promise<Response>
  post: (
    url: string,
    body?: HttpBody,
    headers?: Record<string, string>,
    signal?: AbortSignal,
  ) => Promise<Response>
  close: () => Promise<void>
}

const REQUEST_TIMEOUT_MS = 15_000

/** Standard browser headers to avoid TikTok WAF detection. */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
}

export async function createHttpClient(config: RecorderConfig): Promise<HttpClient> {
  const session: Session = await createSession({
    browser: "firefox_149",
    os: "windows",
    proxy: config.proxy,
  })

  // Seed cookies into the session jar so all subsequent requests are authenticated.
  // NOTE: Using a Cookie header does NOT populate wreq-js's cookie jar —
  // we must use session.setCookie() instead.
  // Seed for all TikTok domains since cookies may not propagate across
  // subdomains automatically in wreq-js's cookie jar.
  if (config.cookies && "sessionid_ss" in config.cookies) {
    const domains = ["https://www.tiktok.com", "https://webcast.tiktok.com", "https://m.tiktok.com"]
    for (const domain of domains) {
      for (const [name, value] of Object.entries(config.cookies)) {
        session.setCookie(name, value, domain)
      }
    }
  }

  const rateLimiter = createRateLimiter(config.ratePerSecond ?? 5)

  async function rateLimitedFetch(
    url: string,
    options?: { method?: string; body?: unknown; headers?: Record<string, string> },
    external?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController()
    const onAbort = () => controller.abort(external?.reason)
    if (external?.aborted) controller.abort(external.reason)
    else external?.addEventListener("abort", onAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      await rateLimiter.acquire(controller.signal)
      const res = await session.fetch(url, {
        method: options?.method,
        body: options?.body as never,
        headers: {
          ...BROWSER_HEADERS,
          ...options?.headers,
        },
        signal: controller.signal,
      })
      // SAFETY: wreq-js returns its own Response-compatible object; the port only
      // needs the standard `status`, `ok`, and `text()` surface.
      return res as unknown as Response
    } finally {
      clearTimeout(timeout)
      external?.removeEventListener("abort", onAbort)
    }
  }

  return {
    get: async (url: string, signal?: AbortSignal) => rateLimitedFetch(url, undefined, signal),
    post: async (
      url: string,
      body?: HttpBody,
      headers?: Record<string, string>,
      signal?: AbortSignal,
    ) =>
      rateLimitedFetch(
        url,
        {
          method: "POST",
          body: body as never,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            ...headers,
          },
        },
        signal,
      ),
    close: async () => {
      await session.close()
    },
  }
}
