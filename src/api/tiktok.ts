/**
 * TikTok API — resolves room IDs, live status, and stream URLs from a single
 * SIGI_STATE HTML scrape. No webcast API calls needed.
 *
 * Architecture:
 *   createTikTokApi(httpClient) → { getRoomId, isRoomAlive, getLiveUrl }
 *
 * All public methods share a per-tick cache so the page is fetched at most once
 * per poll cycle.
 */

import { TikTokError } from '../config'
import type { HttpClient } from './client'

export interface TikTokApi {
  /** Resolve a username to a room ID. Returns null if not found. */
  getRoomId(user: string): Promise<string | null>
  /** Check if a room is currently live. */
  isRoomAlive(roomId: string): Promise<boolean>
  /** Get the best-quality FLV stream URL for a room. Returns null on failure. */
  getLiveUrl(roomId: string): Promise<string | null>
  /** Invalidate per-tick cache (call at start of each poll tick). */
  invalidateCache(): void
}

const TIKTOK_BASE = 'https://www.tiktok.com'
const WEBCAST_BASE = 'https://webcast.tiktok.com'

export function createTikTokApi(http: HttpClient): TikTokApi {
  // Per-tick cache — stores the last fetched live info so the three public
  // methods don't each fetch the page separately.
  let cached: LiveInfo | null = null
  let cachedUser = ''

  async function ensureCache(user: string): Promise<LiveInfo | null> {
    if (cached && cachedUser === user) return cached
    cached = await fetchLiveInfo(user)
    cachedUser = user
    return cached
  }

  function invalidateCache(): void {
    cached = null
    cachedUser = ''
  }

  return {
    invalidateCache,

    async getRoomId(user: string): Promise<string | null> {
      const info = await ensureCache(user)
      return info?.roomId ?? null
    },

    async isRoomAlive(roomId: string): Promise<boolean> {
      if (cached && String(cached.roomId) === String(roomId)) {
        return cached.isLive
      }
      const info = await fetchLiveInfo(cachedUser || roomId)
      return info?.isLive ?? false
    },

    async getLiveUrl(roomId: string): Promise<string | null> {
      const info = await ensureCache(cachedUser || roomId)
      return info?.streamUrl ?? null
    },
  }

  // ─── Internal: fetch and parse SIGI_STATE ─────────────────

  async function fetchLiveInfo(user: string): Promise<LiveInfo | null> {
    try {
      const res = await http.get(`${TIKTOK_BASE}/@${user}/live`)
      if (!res.ok) return null

      const html = await res.text()
      const sigi = extractSigiState(html)
      if (!sigi) return null

      const liveRoom = sigi.LiveRoom?.liveRoomUserInfo?.liveRoom
      const userInfo = sigi.LiveRoom?.liveRoomUserInfo?.user

      if (!liveRoom || !userInfo?.roomId) return null

      const roomId = String(userInfo.roomId)
      const isLive = liveRoom.status === 2 // 2 = live, 4 = offline

      // Extract stream URL: try SIGI_STATE first, then Webcast API fallback
      let streamUrl: string | null = null
      if (isLive) {
        streamUrl = extractStreamUrlFast(liveRoom)
        if (!streamUrl) {
          streamUrl = findStreamUrlRecursively(sigi)
        }
        if (!streamUrl) {
          streamUrl = await fetchStreamUrlFromApi(roomId)
        }
      }

      return { roomId, isLive, streamUrl, title: liveRoom.title ?? null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new TikTokError('network-error', `Failed to fetch live info: ${msg}`, err)
    }
  }

  /**
   * Fallback: fetch stream URL from the Webcast API.
   * This covers cases where SIGI_STATE doesn't include stream data
   * (e.g. async-loaded room info).
   */
  async function fetchStreamUrlFromApi(roomId: string): Promise<string | null> {
    try {
      const url = `${WEBCAST_BASE}/webcast/room/info/?aid=1988&room_id=${roomId}&type=live`
      const res = await http.get(url)
      if (!res.ok) return null

      const text = await res.text()
      if (!text.length) return null

      const data = JSON.parse(text) as Record<string, unknown>

      // status_code 4003110 = live restriction / room not found
      if ((data as any).status_code === 4003110) return null

      return findStreamUrlRecursively(data)
    } catch {
      return null
    }
  }
}

// ─── Types ──────────────────────────────────────────────────

interface LiveInfo {
  roomId: string
  isLive: boolean
  streamUrl: string | null
  title: string | null
}

interface SigiState {
  LiveRoom?: {
    liveRoomStatus?: number
    liveRoomUserInfo?: {
      user?: {
        roomId?: string | number
      }
      liveRoom?: {
        status?: number // 2 = live, 4 = offline
        title?: string
        startTime?: number
        streamData?: {
          pull_data?: {
            stream_data?: string // JSON string with FLV/HLS URLs
          }
        }
      }
    }
  }
}

// ─── HTML parsing ──────────────────────────────────────────

function extractSigiState(html: string): SigiState | null {
  const match = html.match(/<script\s+id="SIGI_STATE"\s+type="application\/json">(.*?)<\/script>/)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1]) as SigiState
  } catch {
    return null
  }
}

// ─── Stream URL extraction ─────────────────────────────────

/**
 * Fast-path: extract stream URL from the known SIGI_STATE location.
 * This covers ~95% of cases without needing a full recursive search.
 */
function extractStreamUrlFast(
  liveRoom: NonNullable<NonNullable<SigiState['LiveRoom']>['liveRoomUserInfo']>['liveRoom'],
): string | null {
  try {
    const raw = liveRoom?.streamData?.pull_data?.stream_data
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const data = (
      parsed as { data?: { hd?: { main?: { flv?: string } }; ld?: { main?: { flv?: string } } } }
    ).data
    // Prefer HD (720p), fall back to LD (360p)
    return data?.hd?.main?.flv ?? data?.ld?.main?.flv ?? null
  } catch {
    return null
  }
}

/**
 * Brute-force recursive search for a stream URL anywhere in a JSON value.
 * Survives TikTok changing key names or nesting structure.
 *
 * Inspired by PR #430 (Michele0303/tiktok-live-recorder).
 */
function findStreamUrlRecursively(obj: unknown): string | null {
  // Base case: a string — check if it looks like a stream URL
  if (typeof obj === 'string') {
    if (
      (obj.startsWith('http://') || obj.startsWith('https://')) &&
      (obj.includes('.flv') || obj.includes('.m3u8'))
    ) {
      return obj
    }
    return null
  }

  // Dict: recurse into all values
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      const found = findStreamUrlRecursively(val)
      if (found) return found
    }
    return null
  }

  // Array: recurse into all elements
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findStreamUrlRecursively(item)
      if (found) return found
    }
  }

  return null
}
