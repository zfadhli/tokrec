import type { LiveInfo } from "../../domain/verdict"
import type { HttpClient } from "../../ports/http"
import type { RoomApiResult, WebcastReader } from "../../ports/tiktok"
import { findStreamUrlRecursively } from "./parse"

const WEBCAST_BASE = "https://webcast.tiktok.com"

export function createWebcastApi(
  http: HttpClient,
  debug: (msg: string) => void,
  flagError: () => void,
): WebcastReader {
  /**
   * Shared boilerplate for Webcast room/info API calls.
   * Handles URL construction, HTTP GET, JSON parsing, and error handling.
   * Room-gate refusals (status_code 4003110) are reported to the caller
   * instead of being collapsed into null; callers map failures.
   * The caller provides an extractor for the response data.
   */
  async function fetchFromRoomApi<T>(
    roomId: string,
    extract: (data: Record<string, unknown>) => T | null,
  ): Promise<RoomApiResult<T>> {
    try {
      const url = `${WEBCAST_BASE}/webcast/room/info/?aid=1988&room_id=${roomId}&type=live`
      const res = await http.get(url)
      debug(`fetchFromRoomApi: roomId=${roomId} status=${res.status}, ok=${res.ok}`)
      if (!res.ok) return { ok: false, statusCode: res.status, body: "" }

      const text = await res.text()
      debug(`fetchFromRoomApi: roomId=${roomId} returned ${text.length} bytes`)
      if (text.length === 0) return { ok: true, value: null }

      const data = JSON.parse(text) as Record<string, unknown>

      // status_code 4003110 = age-protected/restricted room: report it
      if ((data as { status_code?: unknown }).status_code === 4003110) {
        return { ok: false, statusCode: 4003110, body: text }
      }

      return { ok: true, value: extract(data) }
    } catch {
      flagError()
      return { ok: false, statusCode: 0, body: "" }
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
   * Resolve a 4003110 room-gate refusal via check_alive: alive → restricted,
   * otherwise offline. Single home for this mapping so call sites don't repeat it.
   */
  async function resolveRefusedRoom(
    roomId: string,
    source: string,
    title: string | null,
  ): Promise<LiveInfo> {
    debug(`resolveRefusedRoom: room/info refused roomId=${roomId} (status_code 4003110)`)
    const alive = await fetchCheckAlive(roomId)
    if (alive) {
      return { roomId, isLive: true, streamUrl: null, title, reason: "restricted", source }
    }
    return { roomId, isLive: false, streamUrl: null, title, reason: "offline", source }
  }

  /**
   * Fetch room info from the Webcast room/info API. Requires a known roomId.
   * A 4003110 refusal is resolved via check_alive: alive → restricted,
   * otherwise offline.
   */
  async function fetchRoomInfoFromRoomApi(roomId: string): Promise<LiveInfo | null> {
    const res = await fetchFromRoomApi<Record<string, unknown>>(
      roomId,
      (data) => (data as { data?: Record<string, unknown> }).data ?? null,
    )
    if (!res.ok) {
      if (res.statusCode === 4003110) {
        return resolveRefusedRoom(roomId, "room-info", null)
      }
      return null
    }
    const roomData = res.value
    if (!roomData) return null

    const status = roomData.status ?? 4
    const isLive = status === 2
    const title = (roomData.title as string | undefined) ?? null
    if (!isLive) {
      return {
        roomId,
        isLive: false,
        streamUrl: null,
        title,
        reason: "offline",
        source: "room-info",
      }
    }
    const streamUrl = findStreamUrlRecursively(roomData)
    if (streamUrl) {
      return { roomId, isLive: true, streamUrl, title, reason: "live", source: "room-info" }
    }
    return {
      roomId,
      isLive: true,
      streamUrl: null,
      title,
      reason: "no-stream-url",
      source: "room-info",
    }
  }

  /**
   * Fetch stream URL from the Webcast API.
   * Covers cases where SIGI_STATE doesn't include stream data.
   * Refusals (4003110) and transport failures are reported so callers
   * can distinguish restricted rooms from missing URLs.
   */
  async function fetchStreamUrlFromApi(roomId: string): Promise<RoomApiResult<string>> {
    return fetchFromRoomApi(roomId, (data) => findStreamUrlRecursively(data))
  }

  return {
    fetchFromRoomApi,
    fetchCheckAlive,
    fetchStreamUrlFromApi,
    fetchRoomInfoFromRoomApi,
    resolveRefusedRoom,
  }
}
