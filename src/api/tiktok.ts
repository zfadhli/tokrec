/**
 * TikTok API — resolves room IDs, checks live status, and retrieves stream URLs.
 * Uses HTML scraping (SIGI_STATE) as primary method with TikTok API fallback.
 *
 * Architecture:
 *   createTikTokApi(httpClient) → { getRoomId, isRoomAlive, getLiveUrl }
 *
 * All functions return null on failure (caller decides what to do).
 */

import { TikTokError } from '../config'
import type { HttpClient } from './client'

export interface TikTokApi {
  /** Resolve a username to a room ID. Returns null if not live or not found. */
  getRoomId(user: string): Promise<string | null>
  /** Check if a room is currently alive (streaming). */
  isRoomAlive(roomId: string): Promise<boolean>
  /** Get the best-quality FLV stream URL for a room. Returns null on failure. */
  getLiveUrl(roomId: string): Promise<string | null>
}

const TIKTOK_BASE = 'https://www.tiktok.com'
const API_LIVE = 'https://www.tiktok.com/api-live/user/room/'
const WEBCAST_BASE = 'https://webcast.tiktok.com'

export function createTikTokApi(http: HttpClient): TikTokApi {
  return {
    /**
     * Resolve username → room_id.
     * 1. Try HTML scrape (SIGI_STATE) — fastest, no signing needed
     * 2. Fallback to TikTok API — more reliable but may require signing
     */
    async getRoomId(user: string): Promise<string | null> {
      // Method 1: HTML scrape SIGI_STATE
      try {
        const html = await fetchPage(user)
        const roomId = extractRoomIdFromHtml(html)
        if (roomId) return roomId
      } catch {
        // Fall through to API method
      }

      // Method 2: TikTok API
      try {
        const apiRoomId = await fetchRoomIdFromApi(user)
        if (apiRoomId) return apiRoomId
      } catch {
        // Fall through — user is offline or blocked
      }

      return null
    },

    /**
     * Check if a room is currently live.
     * Uses the webcast check_alive endpoint.
     */
    async isRoomAlive(roomId: string): Promise<boolean> {
      try {
        const url = `${WEBCAST_BASE}/webcast/room/check_alive/?room_id=${roomId}`
        const res = await http.get(url)
        if (!res.ok) return false
        const data = (await res.json()) as { data: { alive: number } }
        return data?.data?.alive === 1
      } catch {
        return false
      }
    },

    /**
     * Get the best-quality FLV stream URL for a room.
     * Parses the live room info from TikTok's webcast API.
     *
     * Priority order:
     *   1. live_core_sdk_data.pull_data.stream_data (modern SDK stream data)
     *   2. flv_pull_url (legacy FLV URLs: FULL_HD1 > HD1 > SD1 > SD2)
     *   3. rtmp_pull_url (last resort)
     */
    async getLiveUrl(roomId: string): Promise<string | null> {
      try {
        const url = `${WEBCAST_BASE}/webcast/room/info/?room_id=${roomId}&type=live`
        const res = await http.get(url)
        if (!res.ok) return null

        const data = (await res.json()) as RoomInfoResponse
        if (!data?.data) return null

        const roomData = data.data

        // Method 1: SDK stream data (modern)
        const sdkUrl = extractSdkStreamUrl(roomData)
        if (sdkUrl) return sdkUrl

        // Method 2: Legacy FLV pull URLs
        const flvUrl = extractFlvPullUrl(roomData)
        if (flvUrl) return flvUrl

        // Method 3: RTMP
        const rtmpUrl = roomData.rtmp_pull_url
        if (rtmpUrl && typeof rtmpUrl === 'string' && rtmpUrl.length > 0) return rtmpUrl

        return null
      } catch {
        return null
      }
    },
  }

  // ─── Internal helpers ────────────────────────────────────

  async function fetchPage(user: string): Promise<string> {
    const res = await http.get(`${TIKTOK_BASE}/@${user}/live`)
    if (!res.ok) {
      throw new TikTokError('network-error', `Failed to fetch TikTok page: ${res.status}`)
    }
    return res.text()
  }

  async function fetchRoomIdFromApi(user: string): Promise<string | null> {
    const url = `${API_LIVE}?uniqueId=${user}&sourceType=54`
    const res = await http.get(url)
    if (!res.ok) return null

    const data = (await res.json()) as ApiLiveResponse
    if (!data?.data?.user?.roomId) return null

    const roomId = String(data.data.user.roomId)
    return roomId.length > 0 ? roomId : null
  }
}

// ─── HTML parsing ──────────────────────────────────────────

interface SigiState {
  LiveRoom?: {
    liveRoomUserInfo?: {
      user?: {
        roomId?: string | number
      }
    }
    liveRoom?: {
      status?: number
    }
  }
}

function extractSigiState(html: string): SigiState | null {
  const match = html.match(/<script\s+id="SIGI_STATE"\s+type="application\/json">(.*?)<\/script>/)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1]) as SigiState
  } catch {
    return null
  }
}

function extractRoomIdFromHtml(html: string): string | null {
  const sigi = extractSigiState(html)
  const roomId = sigi?.LiveRoom?.liveRoomUserInfo?.user?.roomId
  if (roomId === undefined || roomId === null) return null
  const str = String(roomId)
  return str.length > 0 ? str : null
}

// ─── API response types ────────────────────────────────────

interface ApiLiveResponse {
  data?: {
    user?: {
      roomId?: string | number
    }
    liveRoom?: {
      status?: number
    }
  }
}

interface RoomInfoResponse {
  data?: {
    status?: number
    rtmp_pull_url?: string
    flv_pull_url?: Record<string, string>
    live_core_sdk_data?: {
      pull_data?: {
        stream_data?: SDKStreamData
      }
    }
  }
}

interface SDKStreamData {
  [key: string]: unknown
}

function extractSdkStreamUrl(data: NonNullable<RoomInfoResponse['data']>): string | null {
  try {
    const streamData = data.live_core_sdk_data?.pull_data?.stream_data
    if (!streamData) return null

    // The SDK data can be in various formats. Try common patterns.
    // Sometimes it's a serialized JSON string, sometimes a nested object
    const raw = JSON.stringify(streamData)

    // Look for flv URL patterns in the SDK data
    const flvMatch = raw.match(/"flv":"(https?[^"]+)"/)
    if (flvMatch?.[1]) return unescapeUnicode(flvMatch[1])

    const hlsMatch = raw.match(/"hls":"(https?[^"]+)"/)
    if (hlsMatch?.[1]) return unescapeUnicode(hlsMatch[1])

    return null
  } catch {
    return null
  }
}

function extractFlvPullUrl(data: NonNullable<RoomInfoResponse['data']>): string | null {
  const flv = data.flv_pull_url
  if (!flv || typeof flv !== 'object') return null

  // Priority order: highest quality first
  const priority = ['FULL_HD1', 'HD1', 'SD1', 'SD2']
  for (const key of priority) {
    const url = flv[key]
    if (url && typeof url === 'string' && url.length > 0) return url
  }

  // Fallback: return the first available URL
  const first = Object.values(flv)[0]
  if (first && typeof first === 'string') return first

  return null
}

function unescapeUnicode(str: string): string {
  return str.replace(/\\u([\da-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}
