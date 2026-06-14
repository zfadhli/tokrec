/**
 * HTTP client — thin wrapper around wreq-js createSession.
 * Provides TLS fingerprint impersonation, cookie jar, proxy support,
 * and configurable rate limiting to prevent WAF triggering.
 */

import { createSession, type Session } from "wreq-js"
import type { RecorderConfig } from "../config"
import { createRateLimiter } from "./rate-limiter"

export interface HttpClient {
  get: (url: string) => Promise<Response>
  post: (url: string, body?: BodyInit, headers?: Record<string, string>) => Promise<Response>
  close: () => Promise<void>
}

const REQUEST_TIMEOUT_MS = 15_000

export async function createHttpClient(config: RecorderConfig): Promise<HttpClient> {
  const session: Session = await createSession({
    browser: "chrome_142",
    os: "windows",
    proxy: config.proxy,
  })

  // Seed cookies into the session jar so all subsequent requests are authenticated.
  // NOTE: Using a Cookie header does NOT populate wreq-js's cookie jar —
  // we must use session.setCookie() instead.
  // Seed for all TikTok domains since cookies may not propagate across
  // subdomains automatically in wreq-js's cookie jar.
  if (config.cookies?.sessionid_ss) {
    for (const domain of [
      "https://www.tiktok.com",
      "https://webcast.tiktok.com",
      "https://m.tiktok.com",
    ]) {
      session.setCookie("sessionid_ss", config.cookies.sessionid_ss, domain)
      if (config.cookies["tt-target-idc"]) {
        session.setCookie("tt-target-idc", config.cookies["tt-target-idc"], domain)
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
        body: options?.body as any,
        headers: options?.headers,
        signal: controller.signal,
      })
      return res as unknown as Response
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    get: async (url: string) => rateLimitedFetch(url),
    post: async (url: string, body?: BodyInit, headers?: Record<string, string>) =>
      rateLimitedFetch(url, {
        method: "POST",
        body: body as any,
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
