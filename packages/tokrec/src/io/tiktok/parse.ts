export interface SigiState {
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
export function extractStreamUrlFast(
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
