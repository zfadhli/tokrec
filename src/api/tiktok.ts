/**
 * TikTok API — resolves room IDs, live status, and stream URLs.
 *
 * Primary path: parse SIGI_STATE from the user's /live page (fast path for
 * older TikTok pages).  When SIGI_STATE is absent (TikTok's new unified page
 * structure), falls back to __UNIVERSAL_DATA_FOR_REHYDRATION__ on the profile
 * page to extract the numeric user ID, then calls the Webcast API
 * (room/enter/) for live status and stream URL.
 *
 * Architecture:
 *   createTikTokApi(httpClient) → { getRoomId, isRoomAlive, getLiveUrl }
 *
 * All public methods share a per-tick cache so the page is fetched at most once
 * per poll cycle.
 */

import type { HttpClient } from "./client"

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

const TIKTOK_BASE = "https://www.tiktok.com"
const WEBCAST_BASE = "https://webcast.tiktok.com"

export function createTikTokApi(http: HttpClient): TikTokApi {
  // Per-tick cache — stores the last fetched live info so the three public
  // methods don't each fetch the page separately.
  let cached: LiveInfo | null = null
  let cachedUser = ""

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

  // ─── Internal: fetch and parse SIGI_STATE / Universal Data ──

  async function fetchLiveInfo(user: string): Promise<LiveInfo | null> {
    let sigi: SigiState | null = null
    let html = ""

    try {
      const res = await http.get(`${TIKTOK_BASE}/@${user}/live`)
      if (!res.ok) return null

      html = await res.text()
      sigi = extractSigiState(html)

      if (sigi) {
        // ── Primary path: room info in LiveRoom.liveRoomUserInfo ──
        const liveRoom = sigi.LiveRoom?.liveRoomUserInfo?.liveRoom
        const userInfo = sigi.LiveRoom?.liveRoomUserInfo?.user

        if (liveRoom && userInfo?.roomId) {
          const roomId = String(userInfo.roomId)
          const isLive = liveRoom.status === 2 // 2 = live, 4 = offline

          // Extract stream URL: try SIGI_STATE first, then Webcast API fallback
          let streamUrl: string | null = null
          if (isLive) {
            streamUrl = extractStreamUrlFast(liveRoom)
            if (!streamUrl) streamUrl = findStreamUrlRecursively(sigi)
            if (!streamUrl) streamUrl = await fetchStreamUrlFromApi(roomId)
          }

          return { roomId, isLive, streamUrl, title: liveRoom.title ?? null }
        }

        // ── Legacy fallback: async-loaded SIGI_STATE ──
        const legacy = await fetchLiveInfoFallback(sigi, user)
        if (legacy) return legacy
      }
    } catch (_err) {
      // Timeout (15s) or network error → treat as offline
      return null
    }

    // ── New fallback: TikTok's unified page structure ──
    // TikTok migrated from SIGI_STATE to __UNIVERSAL_DATA_FOR_REHYDRATION__.
    // The /live page may not have it, so try the main profile page.
    const { userId, roomId } = extractUserFromUniversalData(html)
    if (roomId) {
      // If the /live page has the roomId, use room/info (reliable)
      const result = await fetchRoomInfoFromRoomApi(roomId)
      if (result) return result
    }
    if (userId) {
      // Fallback: try room/enter with the numeric user ID
      const result = await fetchRoomInfoFromApi(userId)
      if (result) return result
    }

    // Final fallback: fetch the main profile page for webapp.user-detail
    return fetchLiveInfoFromProfile(user)
  }

  /**
   * Fetch the main profile page to extract user info from
   * __UNIVERSAL_DATA_FOR_REHYDRATION__. When the user is live, their
   * roomId is embedded in the data, allowing us to fetch room info and
   * stream URL via the /webcast/room/info/ endpoint (which works
   * reliably). Falls back to room/enter/ via the numeric userId.
   */
  async function fetchLiveInfoFromProfile(user: string): Promise<LiveInfo | null> {
    try {
      const res = await http.get(`${TIKTOK_BASE}/@${user}`)
      if (!res.ok) return null

      const html = await res.text()
      const { userId, roomId } = extractUserFromUniversalData(html)
      if (!userId) return null

      // If roomId is embedded in the profile page, the user is live.
      // Use room/info which works reliably for both live and offline rooms.
      if (roomId) {
        return fetchRoomInfoFromRoomApi(roomId)
      }

      // Fallback: try Webcast room/enter with the numeric userId
      return fetchRoomInfoFromApi(userId)
    } catch {
      return null
    }
  }

  /**
   * Fetch room info from the Webcast room/info API (reliable, works
   * for both live and offline rooms). Requires a known roomId.
   */
  async function fetchRoomInfoFromRoomApi(roomId: string): Promise<LiveInfo | null> {
    try {
      const url = `${WEBCAST_BASE}/webcast/room/info/?aid=1988&room_id=${roomId}&type=live`
      const res = await http.get(url)
      if (!res.ok) return null

      const text = await res.text()
      if (text.length === 0) return null

      const data = JSON.parse(text) as Record<string, unknown>

      // status_code 4003110 = live restriction / room not found
      if ((data as any).status_code === 4003110) return null

      const roomData = (data as any).data
      if (!roomData) return null

      const status = roomData.status ?? 4
      const isLive = status === 2
      const streamUrl = isLive ? findStreamUrlRecursively(roomData) : null

      return { roomId, isLive, streamUrl, title: roomData.title ?? null }
    } catch {
      return null
    }
  }

  /**
   * Secondary live-info extraction when SIGI_STATE's LiveRoom data is
   * async-loaded.  Uses LiveRoom.liveRoomStatus for the live flag and
   * UserModule.users[user].roomId for the room ID.  Stream URL is obtained
   * from the Webcast API (room/info/) as a final fallback.
   */
  async function fetchLiveInfoFallback(sigi: SigiState, user: string): Promise<LiveInfo | null> {
    const liveRoomStatus = sigi.LiveRoom?.liveRoomStatus
    const isLive = liveRoomStatus === 2 // 2 = live

    // Try to get roomId from UserModule (usually populated even when LiveRoom is not)
    const userModule = sigi.UserModule?.users?.[user]
    let roomId: string | null = null

    if (userModule?.roomId) {
      roomId =
        typeof userModule.roomId === "object"
          ? String((userModule.roomId as { id: string }).id ?? "")
          : String(userModule.roomId)
    }

    // If we have a roomId, use Webcast room/info for the stream URL
    if (roomId) {
      const streamUrl = isLive ? await fetchStreamUrlFromApi(roomId) : null
      return { roomId, isLive, streamUrl, title: null }
    }

    // Final fallback: Webcast room/enter API using the numeric user ID
    if (userModule?.id && isLive) {
      return fetchRoomInfoFromApi(userModule.id)
    }

    return null // truly offline / unknown
  }

  /**
   * Fallback: fetch room info + stream URL from the Webcast API.
   * This covers cases where SIGI_STATE has no room data at all
   * (fully async-loaded page).
   */
  async function fetchRoomInfoFromApi(userId: string): Promise<LiveInfo | null> {
    try {
      const url = `${WEBCAST_BASE}/webcast/room/enter/?aid=1988&user_id=${userId}`
      const res = await http.get(url)
      if (!res.ok) return null

      const text = await res.text()
      if (text.length === 0) return null

      const data = JSON.parse(text) as Record<string, unknown>
      const roomData = (data as any)?.data?.room
      if (!roomData) return null

      const roomId = String(roomData.roomId ?? "")
      if (!roomId) return null

      const roomStatus = roomData.status // 2 = live
      const isLive = roomStatus === 2
      const streamUrl = isLive ? findStreamUrlRecursively(roomData) : null

      return { roomId, isLive, streamUrl, title: roomData.title ?? null }
    } catch {
      return null
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
      if (text.length === 0) return null

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
        id?: string | number
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
  UserModule?: {
    users?: {
      [username: string]: {
        id?: string // numeric user ID
        uniqueId?: string
        roomId?: string | { id: string }
      }
    }
  }
}

// ─── HTML parsing ──────────────────────────────────────────

/**
 * @public Exported for testing.
 */
export function extractSigiState(html: string): SigiState | null {
  const match = html.match(/<script\s+id="SIGI_STATE"\s+type="application\/json">(.*?)<\/script>/)
  if (!match?.[1]) return null
  try {
    return JSON.parse(match[1]) as SigiState
  } catch {
    return null
  }
}

/**
 * Extract the numeric user ID and optional room ID from TikTok's new
 * page structure (__UNIVERSAL_DATA_FOR_REHYDRATION__).
 *
 * The profile page (/@user) includes "webapp.user-detail" which
 * contains the user's numeric ID. When the user is live, the roomId
 * is also embedded here.
 *
 * Returns { userId, roomId } where userId is always set when the data
 * is found, and roomId is set only when the user is currently live.
 *
 * @public Exported for testing and fixture capture.
 */
export function extractUserFromUniversalData(html: string): {
  userId: string | null
  roomId: string | null
} {
  const match = html.match(
    /<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"\s+type="application\/json">(.*?)<\/script>/,
  )
  if (!match?.[1]) return { userId: null, roomId: null }
  try {
    const data = JSON.parse(match[1])
    const scope = (data as any).__DEFAULT_SCOPE__ ?? data
    const userDetail = scope?.["webapp.user-detail"]
    const user = userDetail?.userInfo?.user
    const userId = user?.id ? String(user.id) : null
    const roomId = user?.roomId ? String(user.roomId) : null
    return { userId, roomId }
  } catch {
    return { userId: null, roomId: null }
  }
}

// ─── Stream URL extraction ─────────────────────────────────

/**
 * Fast-path: extract stream URL from the known SIGI_STATE location.
 * This covers ~95% of cases without needing a full recursive search.
 */
function extractStreamUrlFast(
  liveRoom: NonNullable<NonNullable<SigiState["LiveRoom"]>["liveRoomUserInfo"]>["liveRoom"],
): string | null {
  try {
    const raw = liveRoom?.streamData?.pull_data?.stream_data
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const data = (parsed as Record<string, unknown>)?.data as Record<string, unknown> | undefined
    if (!data) return null

    // Try all known quality keys, preferring higher quality
    const qualities = ["origin", "fhd", "uhd", "hd", "sd", "ld"]
    for (const q of qualities) {
      const entry = data[q] as { main?: { flv?: string } } | undefined
      const url = entry?.main?.flv
      if (url) return url
    }
    return null
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
export function findStreamUrlRecursively(obj: unknown): string | null {
  // Base case: a string
  if (typeof obj === "string") {
    // Direct URL match
    if (
      (obj.startsWith("http://") || obj.startsWith("https://")) &&
      (obj.includes(".flv") || obj.includes(".m3u8"))
    ) {
      return obj
    }
    // JSON-encoded string — parse and recurse (covers stream_data, etc.)
    if (obj.startsWith("{") || obj.startsWith("[")) {
      try {
        return findStreamUrlRecursively(JSON.parse(obj))
      } catch {
        return null
      }
    }
    return null
  }

  // Dict: recurse into all values
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
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
