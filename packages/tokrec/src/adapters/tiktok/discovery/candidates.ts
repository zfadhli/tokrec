import type { RoomRef, SourceId } from "../../../domain/verdict"
import type { Candidate, ResolveContext } from "./types"

/** Nothing found here — let the next source try. */
export function miss(note: string): Candidate {
  return { kind: "miss", note }
}

/** A transport/parse failure. The chain keeps going; it only wins over a miss. */
export function failed(error: unknown): Candidate {
  return { kind: "failed", error: error instanceof Error ? error : new Error(String(error)) }
}

/**
 * Room live with a stream URL. Uses `knownUrl` when the page already carried
 * it; otherwise asks the Webcast API. A 4003110 refusal becomes `denied`.
 */
export async function withStream(
  ctx: ResolveContext,
  room: RoomRef,
  source: SourceId,
  knownUrl: string | null,
): Promise<Candidate> {
  if (knownUrl) return { kind: "room", room, stream: { url: knownUrl }, source }
  const res = await ctx.webcast.fetchStreamUrlFromApi(room.id)
  if (res.ok) {
    return { kind: "room", room, stream: res.value ? { url: res.value } : null, source }
  }
  if (res.statusCode === 4003110) return refused(ctx, room.id, room.title, source)
  return { kind: "room", room, stream: null, source }
}

/** Authoritative room/info lookup: the single 4003110 consumer for room IDs. */
export async function fromRoomInfo(
  ctx: ResolveContext,
  roomId: string,
  source: SourceId,
): Promise<Candidate> {
  const res = await ctx.webcast.roomInfo(roomId)
  if (res.ok) {
    if (!res.value) return miss(`room/info returned no data for ${roomId}`)
    return { kind: "room", room: res.value.room, stream: res.value.stream, source }
  }
  if (res.statusCode === 4003110) return refused(ctx, roomId, null, source)
  if (res.statusCode === 0) return failed(new Error(`room/info transport failure for ${roomId}`))
  return miss(`room/info HTTP ${res.statusCode} for ${roomId}`)
}

/** Gate refusal: check_alive decides whether the room is live (restricted) or offline. */
export async function refused(
  ctx: ResolveContext,
  roomId: string,
  title: string | null,
  source: SourceId,
): Promise<Candidate> {
  const room = await ctx.webcast.refusedRoom(roomId, title)
  return { kind: "denied", room, code: 4003110, source }
}
