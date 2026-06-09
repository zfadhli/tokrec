/**
 * HTTP client — thin wrapper around wreq-js createSession.
 * Provides TLS fingerprint impersonation, cookie jar, and proxy support.
 */

import { type Session, createSession } from 'wreq-js'
import type { RecorderConfig } from '../config'

export interface HttpClient {
  get: (url: string) => Promise<Response>
  post: (url: string, body?: BodyInit, headers?: Record<string, string>) => Promise<Response>
  close: () => Promise<void>
}

export async function createHttpClient(config: RecorderConfig): Promise<HttpClient> {
  const session: Session = await createSession({
    browser: 'chrome_142',
    os: 'windows',
    proxy: config.proxy,
  } as any)

  // Seed cookies if provided (set initial Cookie header to populate the jar)
  if (config.cookies?.sessionid_ss) {
    const cookieParts: string[] = [`sessionid_ss=${config.cookies.sessionid_ss}`]
    if (config.cookies['tt-target-idc']) {
      cookieParts.push(`tt-target-idc=${config.cookies['tt-target-idc']}`)
    }
    // Make an initial request to seed the cookie jar
    await session.fetch('https://www.tiktok.com/', {
      headers: {
        Cookie: cookieParts.join('; '),
      },
    } as any)
  }

  return {
    get: async (url: string) => {
      const res = await session.fetch(url)
      return res as unknown as Response
    },
    post: async (url: string, body?: BodyInit, headers?: Record<string, string>) => {
      const res = await session.fetch(url, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
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
