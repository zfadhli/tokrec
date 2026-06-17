/**
 * Mock HTTP client for testing TikTok API logic with fixture data.
 *
 * Usage:
 *   const http = createMockHttp({
 *     'https://www.tiktok.com/@user/live': livePageHtml,
 *     'https://webcast.tiktok.com/webcast/room/info/': roomInfoJson,
 *   })
 *   const api = createTikTokApi(http)
 */

import type { HttpClient } from "../../src/core/api/client"

export interface MockResponse {
  status: number
  body: string
}

export type ResponseMap = Record<string, string | MockResponse>

/**
 * Create a mock HttpClient that returns fixture data based on URL patterns.
 * URLs are matched by prefix (the first registered URL that the request URL
 * starts with wins), allowing query params to be ignored.
 */
export function createMockHttp(responses: ResponseMap): HttpClient {
  const map = new Map<string, MockResponse>()

  for (const [url, res] of Object.entries(responses)) {
    map.set(url, typeof res === "string" ? { status: 200, body: res } : res)
  }

  async function match(url: string): Promise<Response> {
    // Find the first registered URL that is a prefix of the request URL
    for (const [prefix, mock] of map) {
      if (url.startsWith(prefix)) {
        return new Response(mock.body, {
          status: mock.status,
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      }
    }

    // No match: return 404
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    })
  }

  return {
    get: async (url: string) => match(url),
    post: async (_url: string) => new Response("Not implemented", { status: 501 }),
    close: async () => {},
  }
}

/**
 * Load a fixture file and return its contents as a string.
 */
export function loadFixture(...parts: string[]): string {
  const path = join(__dirname, "..", "fixtures", ...parts)
  return readFileSync(path, "utf-8")
}

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
