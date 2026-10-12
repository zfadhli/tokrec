/**
 * TikTok API — resolves room IDs, live status, and stream URLs.
 *
 * Primary path: parse SIGI_STATE from the user's /live page (fast path for
 * older TikTok pages).  When SIGI_STATE is absent (TikTok's new unified page
 * structure), falls back to __UNIVERSAL_DATA_FOR_REHYDRATION__ on the profile
 * page to extract the room ID, then calls the Webcast room/info API for live
 * status and stream URL.
 *
 * Architecture:
 *   createTikTokApi(httpClient) → { getRoomId, isRoomAlive, getLiveUrl }
 *
 * All public methods share a per-tick cache so the page is fetched at most once
 * per poll cycle.
 *
 * Note: The room/enter Webcast endpoint has been deprecated due to frequent
 * 403 errors. All lookups go through room/info (reliable for live + offline).
 */

import type { Logger } from "../../lib/logger"
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

const TIKTOK_BASES = ["https://www.tiktok.com", "https://m.tiktok.com"]
const WEBCAST_BASE = "https://webcast.tiktok.com"

export function createTikTokApi(http: HttpClient, logger?: Logger, showDebug?: boolean): TikTokApi {
  // Debug logging helper — writes to stderr only when --debug is passed.
  const debug = (msg: string) => {
    logger?.debug(msg)
    if (showDebug) process.stderr.write(`[API_DEBUG] ${msg}\n`)
  }
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
      // Use the lightweight check_alive endpoint instead of re-fetching
      // the full room/info response.
      return fetchCheckAlive(roomId)
    },

    async getLiveUrl(roomId: string): Promise<string | null> {
      const info = await ensureCache(cachedUser || roomId)
      return info?.streamUrl ?? null
    },
  }

  // ─── Internal: fetch and parse SIGI_STATE / Universal Data ──

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
      const res = await http.get(url)
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

  async function fetchLiveInfo(user: string): Promise<LiveInfo | null> {
    let sigi: SigiState | null = null
    let html = ""

    try {
      const page = await tryFetchPage(user, "/live")
      if (!page) {
        debug("fetchLiveInfo: all domains blocked for /live page")
        // Fall through to universal data / profile page fallback
        html = ""
      } else {
        html = page.html
        debug(
          `fetchLiveInfo: /live returned ${html.length} bytes (${page.baseUrl}), first 300: ${html.slice(0, 300).replace(/\n/g, "\\n")}`,
        )

        sigi = extractSigiState(html)
        debug(`fetchLiveInfo: SIGI_STATE ${sigi ? "found" : "not found"}`)

        if (sigi) {
          const liveRoom = sigi.LiveRoom?.liveRoomUserInfo?.liveRoom
          const userInfo = sigi.LiveRoom?.liveRoomUserInfo?.user

          debug(
            `fetchLiveInfo: liveRoom=${!!liveRoom}, userInfo=${!!userInfo}, userInfo.roomId=${userInfo?.roomId ?? "null"}`,
          )

          // ── Primary path: liveRoom is populated (server-rendered) ──
          if (liveRoom && userInfo?.roomId) {
            const roomId = String(userInfo.roomId)
            const isLive = liveRoom.status === 2 // 2 = live, 4 = offline
            debug(
              `fetchLiveInfo: primary path — roomId=${roomId}, status=${liveRoom.status}, isLive=${isLive}`,
            )

            // Extract stream URL: try SIGI_STATE first, then Webcast API fallback
            let streamUrl: string | null = null
            if (isLive) {
              streamUrl = extractStreamUrlFast(liveRoom)
              if (!streamUrl) streamUrl = findStreamUrlRecursively(sigi)
              if (!streamUrl) streamUrl = await fetchStreamUrlFromApi(roomId)
            }

            return { roomId, isLive, streamUrl, title: liveRoom.title ?? null }
          }

          // ── Fallback: userInfo has roomId, but liveRoom is async-loaded ──
          // TikTok may omit liveRoom from the server-rendered page and load it
          // via JavaScript. Query the Webcast API directly — it's authoritative.
          if (userInfo?.roomId) {
            const roomId = String(userInfo.roomId)
            debug(`fetchLiveInfo: userInfo fallback — roomId=${roomId}, querying Webcast API`)
            const roomInfo = await fetchRoomInfoFromRoomApi(roomId)
            debug(`fetchLiveInfo: Webcast API ${roomInfo ? "returned room info" : "returned null"}`)
            if (roomInfo) return roomInfo
          }

          // ── Legacy fallback: async-loaded SIGI_STATE ──
          debug("fetchLiveInfo: trying legacy fallback (UserModule)")
          const legacy = await fetchLiveInfoFallback(sigi, user)
          debug(`fetchLiveInfo: legacy fallback ${legacy ? "succeeded" : "returned null"}`)
          if (legacy) return legacy
        } // end if (sigi)
      } // end else (page loaded)
    } catch (_err) {
      // Timeout (15s) or network error → treat as offline
      debug(`fetchLiveInfo: caught error — ${_err instanceof Error ? _err.message : String(_err)}`)
      return null
    }

    // ── API fallback: when page scraping fails (WAF), use TikTok API directly ──
    // The /api-live/user/room/ endpoint returns roomId + live status without
    // the Slardar WAF that blocks www.tiktok.com HTML pages.
    if (!html || html.length < 5000) {
      debug("fetchLiveInfo: trying API fallback (api-live/user/room)")
      const apiResult = await fetchLiveInfoFromApi(user)
      if (apiResult) return apiResult
    }

    // ── New fallback: TikTok's unified page structure ──
    // TikTok migrated from SIGI_STATE to __UNIVERSAL_DATA_FOR_REHYDRATION__.
    // The /live page may not have it, so try the main profile page.
    debug(`fetchLiveInfo: trying universal data fallback (html length ${html.length})`)
    const { roomId } = extractUserFromUniversalData(html)
    debug(`fetchLiveInfo: universal data roomId=${roomId ?? "null"}`)
    if (roomId) {
      // If the /live page has the roomId, use room/info (reliable)
      const result = await fetchRoomInfoFromRoomApi(roomId)
      debug(`fetchLiveInfo: universal data Webcast API ${result ? "succeeded" : "returned null"}`)
      if (result) return result
    }
    // No roomId available — fall through to profile page to check for
    // __UNIVERSAL_DATA_FOR_REHYDRATION__ which may have the roomId when live.

    // Final fallback: fetch the main profile page for webapp.user-detail
    debug("fetchLiveInfo: trying profile page fallback")
    const profileResult = await fetchLiveInfoFromProfile(user)
    debug(`fetchLiveInfo: profile page ${profileResult ? "succeeded" : "returned null"}`)
    return profileResult
  }

  /**
   * Fetch the main profile page to extract user info from
   * __UNIVERSAL_DATA_FOR_REHYDRATION__. When the user is live, their
   * roomId is embedded in the data, allowing us to fetch room info and
   * stream URL via the /webcast/room/info/ endpoint (which works
   * reliably). If no roomId is present the user is offline.
   */
  async function fetchLiveInfoFromProfile(user: string): Promise<LiveInfo | null> {
    try {
      const page = await tryFetchPage(user, "")
      if (!page) {
        debug("fetchLiveInfoFromProfile: all domains blocked for profile page")
        return null
      }
      debug(
        `fetchLiveInfoFromProfile: returned ${page.html.length} bytes (${page.baseUrl}), first 300: ${page.html.slice(0, 300).replace(/\n/g, "\\n")}`,
      )
      const { userId, roomId } = extractUserFromUniversalData(page.html)
      if (!userId) return null

      // If roomId is embedded in the profile page, the user is live.
      // Use room/info which works reliably for both live and offline rooms.
      if (roomId) {
        return fetchRoomInfoFromRoomApi(roomId)
      }

      // No roomId means the user is offline (room/enter was unreliable).
      return null
    } catch {
      return null
    }
  }

  /**
   * Fetch live info from TikTok's internal API endpoint.
   * This bypasses the Slardar WAF that blocks www.tiktok.com HTML pages.
   *
   * Endpoint: /api-live/user/room/?aid=1988&uniqueId=${user}&sourceType=54
   * Returns the roomId, user status (2 = live), and other user metadata.
   * When the user is live, also queries the Webcast API for a stream URL.
   */
  async function fetchLiveInfoFromApi(user: string): Promise<LiveInfo | null> {
    try {
      const url = `https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=${encodeURIComponent(user)}&sourceType=54`
      const res = await http.get(url)
      debug(`fetchLiveInfoFromApi: ${url} status=${res.status}`)
      if (!res.ok) return null

      const text = await res.text()
      debug(`fetchLiveInfoFromApi: returned ${text.length} bytes`)
      if (text.length === 0) return null

      const data = JSON.parse(text) as Record<string, unknown>
      const userData = (data?.data as Record<string, unknown> | undefined)?.user as
        | { roomId?: string; status?: number; uniqueId?: string }
        | undefined

      if (!userData?.roomId) {
        debug("fetchLiveInfoFromApi: no roomId in API response")
        return null
      }

      const roomId = String(userData.roomId)
      // status: 2 = live, 4 = offline, 1 = ...
      const isLive = userData.status === 2
      debug(`fetchLiveInfoFromApi: roomId=${roomId}, status=${userData.status}, isLive=${isLive}`)

      if (!isLive) {
        return { roomId, isLive: false, streamUrl: null, title: null }
      }

      // Query Webcast API for stream URL
      const streamUrl = await fetchStreamUrlFromApi(roomId)
      return { roomId, isLive: true, streamUrl, title: null }
    } catch {
      return null
    }
  }

  /**
   * Shared boilerplate for Webcast room/info API calls.
   * Handles URL construction, HTTP GET, JSON parsing, status code checks,
   * and error handling. The caller provides an extractor for the response data.
   */
  async function fetchFromRoomApi<T>(
    roomId: string,
    extract: (data: Record<string, unknown>) => T | null,
  ): Promise<T | null> {
    try {
      const url = `${WEBCAST_BASE}/webcast/room/info/?aid=1988&room_id=${roomId}&type=live`
      const res = await http.get(url)
      debug(`fetchFromRoomApi: roomId=${roomId} status=${res.status}, ok=${res.ok}`)
      if (!res.ok) return null

      const text = await res.text()
      debug(`fetchFromRoomApi: roomId=${roomId} returned ${text.length} bytes`)
      if (text.length === 0) return null

      const data = JSON.parse(text) as Record<string, unknown>

      // status_code 4003110 = live restriction / room not found
      if ((data as { status_code?: unknown }).status_code === 4003110) return null

      return extract(data)
    } catch {
      return null
    }
  }

  /**
   * Check if a room is currently alive using the lightweight
   * /webcast/room/check_alive/ endpoint.
   *
   * This is faster and cheaper than fetching the full room/info response.
   * Returns `true` if the room is live, `false` otherwise (including errors).
   *
   * Endpoint: /webcast/room/check_alive/?aid=1988&region=CH&room_ids={id}&user_is_login=true
   * Response: { "data": [{ "alive": true/false, "room_id": "..." }] }
   */
  async function fetchCheckAlive(roomId: string): Promise<boolean> {
    try {
      const url = `${WEBCAST_BASE}/webcast/room/check_alive/?aid=1988&region=CH&room_ids=${roomId}&user_is_login=true`
      const res = await http.get(url)
      debug(`fetchCheckAlive: roomId=${roomId} status=${res.status}, ok=${res.ok}`)
      if (!res.ok) return false

      const text = await res.text()
      debug(`fetchCheckAlive: roomId=${roomId} returned ${text.length} bytes`)
      if (text.length === 0) return false

      const data = JSON.parse(text) as Record<string, unknown>
      const items = data?.data as Array<Record<string, unknown>> | undefined
      const alive = items?.[0]?.alive === true
      debug(`fetchCheckAlive: roomId=${roomId} alive=${alive}`)
      return alive
    } catch (err) {
      debug(
        `fetchCheckAlive: roomId=${roomId} error — ${err instanceof Error ? err.message : String(err)}`,
      )
      return false
    }
  }

  /**
   * Fetch room info from the Webcast room/info API. Requires a known roomId.
   */
  async function fetchRoomInfoFromRoomApi(roomId: string): Promise<LiveInfo | null> {
    return fetchFromRoomApi(roomId, (data) => {
      const roomData = (data as { data?: Record<string, unknown> }).data
      if (!roomData) return null

      const status = roomData.status ?? 4
      const isLive = status === 2
      const streamUrl = isLive ? findStreamUrlRecursively(roomData) : null

      return { roomId, isLive, streamUrl, title: (roomData.title as string | undefined) ?? null }
    })
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

    // No roomId available — treat as offline (room/enter was unreliable).
    return null
  }

  /**
   * Fetch stream URL from the Webcast API.
   * Covers cases where SIGI_STATE doesn't include stream data.
   */
  async function fetchStreamUrlFromApi(roomId: string): Promise<string | null> {
    return fetchFromRoomApi(roomId, (data) => findStreamUrlRecursively(data))
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
    const scope = (data as Record<string, unknown>).__DEFAULT_SCOPE__ ?? data
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
 *
 * Prefers FLV (lower latency) over HLS/other protocols.
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

    // Try all known quality keys, preferring higher quality.
    // FLV is preferred (lower latency); HLS is the fallback.
    const qualities = ["origin", "fhd", "uhd", "hd", "sd", "ld"]
    for (const q of qualities) {
      const entry = data[q] as { main?: { flv?: string; hls?: string } } | undefined
      // Prefer FLV over HLS when both are available
      const url = entry?.main?.flv ?? entry?.main?.hls
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
 * Prefers FLV over HLS when both are present in the response.
 *
 * Inspired by PR #430 (Michele0303/tiktok-live-recorder).
 */
export function findStreamUrlRecursively(obj: unknown): string | null {
  // Collect all candidate URLs with their preference
  const flvUrls: string[] = []
  const m3u8Urls: string[] = []

  function walk(value: unknown): void {
    if (typeof value === "string") {
      // Direct URL match
      if (
        (value.startsWith("http://") || value.startsWith("https://")) &&
        (value.includes(".flv") || value.includes(".m3u8"))
      ) {
        if (value.includes(".flv")) {
          flvUrls.push(value)
        } else {
          m3u8Urls.push(value)
        }
        return
      }
      // JSON-encoded string — parse and recurse
      if (value.startsWith("{") || value.startsWith("[")) {
        try {
          walk(JSON.parse(value))
        } catch {
          // skip
        }
      }
      return
    }

    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        for (const item of value) {
          walk(item)
        }
      } else {
        for (const val of Object.values(value as Record<string, unknown>)) {
          walk(val)
        }
      }
    }
  }

  walk(obj)

  // Prefer FLV (lower latency) over HLS
  if (flvUrls.length > 0) return flvUrls[0] as string
  if (m3u8Urls.length > 0) return m3u8Urls[0] as string
  return null
}
