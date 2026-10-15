import type { SigiState } from "../parse"
import type { LiveInfo, ResolveContext } from "./types"

/**
 * Secondary live-info extraction when SIGI_STATE's LiveRoom data is
 * async-loaded.  Uses LiveRoom.liveRoomStatus for the live flag and
 * UserModule.users[user].roomId for the room ID.  Stream URL is obtained
 * from the Webcast API (room/info/) as a final fallback.
 */
export async function fetchSigiLegacy(
  sigi: SigiState,
  ctx: ResolveContext,
): Promise<LiveInfo | null> {
  const liveRoomStatus = sigi.LiveRoom?.liveRoomStatus
  const isLive = liveRoomStatus === 2 // 2 = live

  // Try to get roomId from UserModule (usually populated even when LiveRoom is not)
  const userModule = sigi.UserModule?.users?.[ctx.user]
  let roomId: string | null = null

  if (userModule?.roomId) {
    roomId =
      typeof userModule.roomId === "object"
        ? String((userModule.roomId as { id: string }).id ?? "")
        : String(userModule.roomId)
  }

  // If we have a roomId, use Webcast room/info for the stream URL
  if (roomId) {
    if (!isLive) {
      return {
        roomId,
        isLive: false,
        streamUrl: null,
        title: null,
        reason: "offline",
        source: "sigi",
      }
    }
    const streamRes = await ctx.webcast.fetchStreamUrlFromApi(roomId)
    if (streamRes.ok) {
      if (streamRes.value) {
        return {
          roomId,
          isLive: true,
          streamUrl: streamRes.value,
          title: null,
          reason: "live",
          source: "sigi",
        }
      }
      return {
        roomId,
        isLive: true,
        streamUrl: null,
        title: null,
        reason: "no-stream-url",
        source: "sigi",
      }
    }
    if (streamRes.statusCode === 4003110) {
      return ctx.webcast.resolveRefusedRoom(roomId, "sigi", null)
    }
    return {
      roomId,
      isLive: true,
      streamUrl: null,
      title: null,
      reason: "no-stream-url",
      source: "sigi",
    }
  }

  // No roomId available — treat as offline (room/enter was unreliable).
  return null
}
