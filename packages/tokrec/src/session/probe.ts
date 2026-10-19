/**
 * TikTok API — resolves room IDs, live status, and stream URLs.
 *
 * `createTikTokApi` is a thin orchestrator: per-user cache, cache invalidation,
 * and `discover()` over sources returning `Candidate`s. The chain turns
 * failures into evidence instead of aborting. `getVerdict` is the only
 * public verdict surface.
 *
 * Architecture:
 *   createTikTokApi(httpClient) → { isRoomAlive, getLiveUrl, getVerdict }
 *
 * All public methods share a per-tick cache so the page is fetched at most once
 * per poll cycle. The optional `signal` aborts in-flight HTTP requests.
 *
 * Note: The room/enter Webcast endpoint has been deprecated due to frequent
 * 403 errors. All lookups go through room/info (reliable for live + offline).
 */

import { createApiLiveSource } from "../adapters/tiktok/discovery/api-live"
import { discover } from "../adapters/tiktok/discovery/chain"
import { createPageSource } from "../adapters/tiktok/discovery/page"
import { createProfileSource } from "../adapters/tiktok/discovery/profile"
import type { DiscoverySource, ResolveContext } from "../adapters/tiktok/discovery/types"
import { createPageFetcher } from "../adapters/tiktok/page"
import { createWebcastApi } from "../adapters/tiktok/webcast"
import { isLiveReason, type Verdict, verdictOf } from "../domain/verdict"
import type { Logger } from "../lib/logger"
import type { HttpClient } from "../ports/http"

export interface TikTokApi {
  /** Check if a room is currently live. */
  isRoomAlive(roomId: string): Promise<boolean>
  /** Get the best-quality FLV stream URL for a room. Returns null on failure. */
  getLiveUrl(roomId: string): Promise<string | null>
  /** Full per-tick verdict with reason, refs, evidence trail, and failure. */
  getVerdict(user: string): Promise<Verdict>
  /** Invalidate per-tick cache (call at start of each poll tick). */
  invalidateCache(): void
}

export function createTikTokApi(
  http: HttpClient,
  logger?: Logger,
  showDebug?: boolean,
  signal?: AbortSignal,
): TikTokApi {
  // Debug logging helper — writes to stderr only when --debug is passed.
  const debug = (msg: string) => {
    logger?.debug(msg)
    if (showDebug) process.stderr.write(`[API_DEBUG] ${msg}\n`)
  }
  let cached: Verdict | null = null
  let cachedUser = ""
  const webcast = createWebcastApi(http, debug, signal)
  const tryFetchPage = createPageFetcher(http, debug, signal)
  const sources: DiscoverySource[] = [
    createPageSource(),
    createApiLiveSource(),
    createProfileSource(),
  ]

  async function ensureCache(user: string): Promise<Verdict> {
    if (cached && cachedUser === user) return cached
    cached = await resolveVerdict(user)
    cachedUser = user
    return cached
  }

  function invalidateCache(): void {
    cached = null
    cachedUser = ""
  }

  return {
    invalidateCache,

    async getVerdict(user: string): Promise<Verdict> {
      return ensureCache(user)
    },

    async isRoomAlive(roomId: string): Promise<boolean> {
      if (cached?.room && String(cached.room.id) === String(roomId)) {
        return isLiveReason(cached.reason)
      }
      // Use the lightweight check_alive endpoint instead of re-fetching
      // the full room/info response.
      return webcast.fetchCheckAlive(roomId)
    },

    async getLiveUrl(roomId: string): Promise<string | null> {
      if (cached?.room && String(cached.room.id) === String(roomId) && cached.stream) {
        return cached.stream.url
      }
      // Room ID, not a username: never route this through ensureCache.
      const res = await webcast.fetchStreamUrlFromApi(roomId)
      return res.ok ? res.value : null
    },
  }

  // ─── Internal: discovery chain → one verdict ───

  async function resolveVerdict(user: string): Promise<Verdict> {
    const ctx: ResolveContext = { user, http, debug, fetchPage: tryFetchPage, webcast }
    const { candidate, evidence } = await discover(sources, ctx)
    switch (candidate.kind) {
      case "room":
        return verdictOf({ room: candidate.room, stream: candidate.stream, evidence })
      case "denied":
        return verdictOf({ room: candidate.room, denied: true, evidence })
      case "failed":
        return verdictOf({ failure: candidate.error, evidence })
      case "miss":
        return verdictOf({ evidence })
    }
  }
}
