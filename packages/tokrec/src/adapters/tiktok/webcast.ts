import type { RoomRef } from "../../domain/verdict"
import type { HttpClient } from "../../ports/http"
import type { RoomApiResult, RoomFacts, WebcastReader } from "../../ports/tiktok"
import { findStreamUrlRecursively } from "./parse"

const WEBCAST_BASE = "https://webcast.tiktok.com"

export function createWebcastApi(
  http: HttpClient,
  debug: (msg: string) => void,
  signal?: AbortSignal,
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
      const res = await http.get(url, signal)
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
      // statusCode 0 = transport/parse failure before a status was available.
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
      const res = await http.get(url, signal)
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
   * Resolve a 4003110 room-gate refusal via check_alive: the room is live
   * (restricted) when alive, offline otherwise. Single home for this mapping.
   */
  async function refusedRoom(roomId: string, title: string | null): Promise<RoomRef> {
    debug(`refusedRoom: room/info refused roomId=${roomId} (status_code 4003110)`)
    const live = await fetchCheckAlive(roomId)
    return { id: roomId, title, live }
  }

  /**
   * Fetch room/info as domain facts. Requires a known roomId. A 4003110
   * refusal stays `{ ok: false, statusCode: 4003110 }` for the caller to map
   * via `refusedRoom`.
   */
  async function roomInfo(roomId: string): Promise<RoomApiResult<RoomFacts>> {
    const res = await fetchFromRoomApi<Record<string, unknown>>(
      roomId,
      (data) => (data as { data?: Record<string, unknown> }).data ?? null,
    )
    if (!res.ok) return res
    const roomData = res.value
    if (!roomData) return { ok: true, value: null }

    const title = (roomData.title as string | undefined) ?? null
    const streamUrl = findStreamUrlRecursively(roomData)
    return {
      ok: true,
      value: {
        room: { id: roomId, title, live: (roomData.status ?? 4) === 2 },
        stream: streamUrl ? { url: streamUrl } : null,
      },
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
    roomInfo,
    refusedRoom,
  }
}
