/**
 * TikTok API — resolves room IDs, live status, and stream URLs.
 *
 * `createTikTokApi` is a thin orchestrator: per-user cache, `getLiveInfo`
 * verdict mapping, and an ordered source chain (page → api-live → profile)
 * built from `resolvers/`. Pure HTML/JSON parsing lives in `parse.ts`;
 * Webcast room/info + check_alive endpoints live in `webcast.ts`.
 *
 * Architecture:
 *   createTikTokApi(httpClient) → { getRoomId, isRoomAlive, getLiveUrl, getLiveInfo }
 *
 * All public methods share a per-tick cache so the page is fetched at most once
 * per poll cycle.
 *
 * Note: The room/enter Webcast endpoint has been deprecated due to frequent
 * 403 errors. All lookups go through room/info (reliable for live + offline).
 */

import type { Logger } from "../../lib/logger"
import type { HttpClient } from "./client"
import { createPageFetcher } from "./page-fetch"
import { createApiLiveSource } from "./resolvers/api-live"
import { createPageSource } from "./resolvers/page"
import { createProfileSource } from "./resolvers/profile"
import type { LiveInfo, ResolveContext, RoomSource } from "./resolvers/types"
import { createWebcastApi } from "./webcast"

export type { LiveInfo } from "./resolvers/types"

export interface TikTokApi {
  /** Resolve a username to a room ID. Returns null if not found. */
  getRoomId(user: string): Promise<string | null>
  /** Check if a room is currently live. */
  isRoomAlive(roomId: string): Promise<boolean>
  /** Get the best-quality FLV stream URL for a room. Returns null on failure. */
  getLiveUrl(roomId: string): Promise<string | null>
  /** Full per-tick verdict with machine-readable reason and discovery source. */
  getLiveInfo(user: string): Promise<LiveInfo>
  /** Invalidate per-tick cache (call at start of each poll tick). */
  invalidateCache(): void
}

export function createTikTokApi(http: HttpClient, logger?: Logger, showDebug?: boolean): TikTokApi {
  // Debug logging helper — writes to stderr only when --debug is passed.
  const debug = (msg: string) => {
    logger?.debug(msg)
    if (showDebug) process.stderr.write(`[API_DEBUG] ${msg}\n`)
  }
  let cached: LiveInfo | null = null
  let cachedUser = ""
  let lastFetchHadError = false
  const webcast = createWebcastApi(http, debug, () => {
    lastFetchHadError = true
  })
  const tryFetchPage = createPageFetcher(http, debug)
  const pageSource = createPageSource()
  const apiLiveSource = createApiLiveSource()
  const profileSource = createProfileSource()
  const sources: RoomSource[] = [pageSource, apiLiveSource, profileSource]

  async function ensureCache(user: string): Promise<LiveInfo | null> {
    if (cached && cachedUser === user) return cached
    cached = await fetchLiveInfo(user)
    cachedUser = user
    return cached
  }

  function invalidateCache(): void {
    cached = null
    cachedUser = ""
  }

  return {
    invalidateCache,

    async getLiveInfo(user: string): Promise<LiveInfo> {
      try {
        const info = await ensureCache(user)
        if (info) return info
        if (lastFetchHadError) {
          return {
            roomId: null,
            isLive: false,
            streamUrl: null,
            title: null,
            reason: "error",
            source: "none",
          }
        }
        return {
          roomId: null,
          isLive: false,
          streamUrl: null,
          title: null,
          reason: "no-room-id",
          source: "none",
        }
      } catch (err) {
        debug(`getLiveInfo: caught error — ${err instanceof Error ? err.message : String(err)}`)
        return {
          roomId: null,
          isLive: false,
          streamUrl: null,
          title: null,
          reason: "error",
          source: "none",
        }
      }
    },

    async getRoomId(user: string): Promise<string | null> {
      const info = await ensureCache(user)
      return info?.roomId ?? null
    },

    async isRoomAlive(roomId: string): Promise<boolean> {
      if (cached && String(cached.roomId) === String(roomId)) {
        return cached.isLive
      }
      // Use the lightweight check_alive endpoint instead of re-fetching
      // the full room/info response.
      return webcast.fetchCheckAlive(roomId)
    },

    async getLiveUrl(roomId: string): Promise<string | null> {
      const info = await ensureCache(cachedUser || roomId)
      return info?.streamUrl ?? null
    },
  }

  // ─── Internal: ordered source chain (page → api-live → profile) ───

  async function fetchLiveInfo(user: string): Promise<LiveInfo | null> {
    lastFetchHadError = false
    const ctx: ResolveContext = {
      user,
      http,
      debug,
      fetchPage: tryFetchPage,
      webcast,
      flagError: () => {
        lastFetchHadError = true
      },
    }
    for (const source of sources) {
      try {
        const info = await source.resolve(ctx)
        if (info) return info
      } catch (_err) {
        debug(
          `fetchLiveInfo: ${source.name} threw — ${_err instanceof Error ? _err.message : String(_err)}`,
        )
        lastFetchHadError = true
        return null
      }
    }
    return null
  }
}
