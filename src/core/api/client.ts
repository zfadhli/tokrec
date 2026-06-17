/**
 * HTTP client — thin wrapper around wreq-js createSession.
 * Provides TLS fingerprint impersonation, cookie jar, proxy support,
 * and configurable rate limiting to prevent WAF triggering.
 */

import { createSession, type Session } from "wreq-js"
import type { RecorderConfig } from "../../lib/config"
import { createRateLimiter } from "./rate-limiter"

// BodyInit is only available inside declare module "bun" in bun-types, not as a global
// under the ES2022 lib. We explicitly import it to keep lib focused on ES2022.
type _BodyInit = import("bun").BodyInit

export interface HttpClient {
  get: (url: string) => Promise<Response>
  post: (url: string, body?: _BodyInit, headers?: Record<string, string>) => Promise<Response>
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
  ): Promise<Response> {
    const controller = new AbortController()
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
      return res as unknown as Response
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    get: async (url: string) => rateLimitedFetch(url),
    post: async (url: string, body?: _BodyInit, headers?: Record<string, string>) =>
      rateLimitedFetch(url, {
        method: "POST",
        body: body as never,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          ...headers,
        },
      }),
    close: async () => {
      await session.close()
    },
  }
}
