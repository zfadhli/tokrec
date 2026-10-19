import type { HttpClient } from "../../ports/http"

const TIKTOK_BASES = ["https://www.tiktok.com", "https://m.tiktok.com"]

export function createPageFetcher(
  http: HttpClient,
  debug: (msg: string) => void,
  signal?: AbortSignal,
): (user: string, path: string) => Promise<{ html: string; baseUrl: string } | null> {
  /**
   * Try to fetch a TikTok user page from multiple domains.
   * www.tiktok.com is increasingly blocked by Slardar WAF; m.tiktok.com
   * often has different bot protection and may succeed.
   * Returns the HTML and the base URL that worked, or null if all fail.
   */
  async function tryFetchPage(
    user: string,
    path: string,
  ): Promise<{ html: string; baseUrl: string } | null> {
    for (const base of TIKTOK_BASES) {
      const url = `${base}/@${user}${path}`
      const res = await http.get(url, signal)
      debug(`tryFetchPage: ${url} status=${res.status}, ok=${res.ok}`)
      if (!res.ok) continue

      const html = await res.text()
      // Reject Slardar WAF challenge pages (small + keyword)
      if (html.length < 5000 || html.includes("SlardarWAF")) {
        debug(
          `tryFetchPage: ${url} WAF blocked (${html.length} bytes, slardar=${html.includes("SlardarWAF")})`,
        )
        continue
      }

      debug(`tryFetchPage: ${url} succeeded (${html.length} bytes)`)
      return { html, baseUrl: base }
    }
    return null
  }

  return tryFetchPage
}
