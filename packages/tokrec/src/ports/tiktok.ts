/**
 * TikTok Webcast port — the room/stream lookups discovery sources depend on.
 *
 * Ports hold interfaces only: no runtime code, no imports outside `ports/`.
 */

import type { LiveInfo } from "../domain/verdict"

/**
 * Discriminated room/info result: refusals (notably status_code 4003110)
 * and transport failures surface as `{ ok: false }` instead of null.
 */
export type RoomApiResult<T> =
  | { ok: true; value: T | null }
  | { ok: false; statusCode: number; body: string }

export interface WebcastReader {
  fetchFromRoomApi: <T>(
    roomId: string,
    extract: (data: Record<string, unknown>) => T | null,
  ) => Promise<RoomApiResult<T>>
  fetchCheckAlive: (roomId: string) => Promise<boolean>
  fetchStreamUrlFromApi: (roomId: string) => Promise<RoomApiResult<string>>
  fetchRoomInfoFromRoomApi: (roomId: string) => Promise<LiveInfo | null>
  resolveRefusedRoom: (roomId: string, source: string, title: string | null) => Promise<LiveInfo>
}
