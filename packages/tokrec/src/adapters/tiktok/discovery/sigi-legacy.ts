import type { RoomRef } from "../../../domain/verdict"
import type { SigiState } from "../parse"
import { miss, withStream } from "./candidates"
import type { Candidate, ResolveContext } from "./types"

/**
 * Secondary live-info extraction when SIGI_STATE's LiveRoom data is
 * async-loaded.  Uses LiveRoom.liveRoomStatus for the live flag and
 * UserModule.users[user].roomId for the room ID.  Stream URL is obtained
 * from the Webcast API (room/info/) as a final fallback.
 */
export async function fetchSigiLegacy(sigi: SigiState, ctx: ResolveContext): Promise<Candidate> {
  const isLive = sigi.LiveRoom?.liveRoomStatus === 2 // 2 = live

  // Try to get roomId from UserModule (usually populated even when LiveRoom is not)
  const userModule = sigi.UserModule?.users?.[ctx.user]
  let roomId: string | null = null

  if (userModule?.roomId) {
    roomId =
      typeof userModule.roomId === "object"
        ? String((userModule.roomId as { id: string }).id ?? "")
        : String(userModule.roomId)
  }

  // No roomId available — treat as offline (room/enter was unreliable).
  if (!roomId) return miss("sigi-legacy: no roomId")

  const room: RoomRef = { id: roomId, title: null, live: isLive }
  if (!isLive) return { kind: "room", room, stream: null, source: "sigi" }
  return withStream(ctx, room, "sigi", null)
}
