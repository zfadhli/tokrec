/**
 * HTTP client — thin wrapper around wreq-js createSession.
 * Provides TLS fingerprint impersonation, cookie jar, and proxy support.
 */

import { type Session, createSession } from "wreq-js"
import type { RecorderConfig } from "../config"

export interface HttpClient {
  get: (url: string) => Promise<Response>
  post: (url: string, body?: BodyInit, headers?: Record<string, string>) => Promise<Response>
  close: () => Promise<void>
}

export async function createHttpClient(config: RecorderConfig): Promise<HttpClient> {
  const session: Session = await createSession({
    browser: "chrome_142",
    os: "windows",
    proxy: config.proxy,
  } as any)

  // Seed cookies into the session jar so all subsequent requests are authenticated.
  // NOTE: Using a Cookie header does NOT populate wreq-js's cookie jar —
  // we must use session.setCookie() instead.
  if (config.cookies?.sessionid_ss) {
    session.setCookie("sessionid_ss", config.cookies.sessionid_ss, "https://www.tiktok.com")
    if (config.cookies["tt-target-idc"]) {
      session.setCookie("tt-target-idc", config.cookies["tt-target-idc"], "https://www.tiktok.com")
    }
  }

  return {
    get: async (url: string) => {
      const res = await session.fetch(url, {
        signal: AbortSignal.timeout(15000),
      } as any)
      return res as unknown as Response
    },
    post: async (url: string, body?: BodyInit, headers?: Record<string, string>) => {
      const res = await session.fetch(url, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          ...headers,
        },
      } as any)
      return res as unknown as Response
    },
    close: async () => {
      await session.close()
    },
  }
}
