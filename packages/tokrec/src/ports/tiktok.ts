/**
 * TikTok Webcast port — the room/stream lookups discovery sources depend on.
 *
 * Ports hold interfaces only: no runtime code, no imports outside `ports/`.
 */

import type { RoomRef, StreamRef } from "../domain/verdict"

/**
 * Discriminated room/info result: refusals (notably status_code 4003110)
 * and transport failures surface as `{ ok: false }` instead of null.
 * `statusCode: 0` means the request threw before a status was read.
 */
export type RoomApiResult<T> =
  | { ok: true; value: T | null }
  | { ok: false; statusCode: number; body: string }

/** Authoritative room/info facts: the room plus its stream URL when present. */
export interface RoomFacts {
  readonly room: RoomRef
  readonly stream: StreamRef | null
}

export interface WebcastReader {
  fetchFromRoomApi: <T>(
    roomId: string,
    extract: (data: Record<string, unknown>) => T | null,
  ) => Promise<RoomApiResult<T>>
  fetchCheckAlive: (roomId: string) => Promise<boolean>
  fetchStreamUrlFromApi: (roomId: string) => Promise<RoomApiResult<string>>
  /** room/info as domain facts; 4003110 comes back as `{ ok: false }`. */
  roomInfo: (roomId: string) => Promise<RoomApiResult<RoomFacts>>
  /** Resolve a 4003110 refusal: alive → restricted candidate, else offline. */
  refusedRoom: (roomId: string, title: string | null) => Promise<RoomRef>
}
