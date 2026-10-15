import { extractUserFromUniversalData } from "../parse"
import type { LiveInfo, ResolveContext, RoomSource } from "./types"

export function createProfileSource(): RoomSource {
  return {
    name: "profile",
    async resolve(ctx: ResolveContext): Promise<LiveInfo | null> {
      try {
        const page = await ctx.fetchPage(ctx.user, "")
        if (!page) {
          ctx.debug("fetchLiveInfoFromProfile: all domains blocked for profile page")
          return null
        }
        ctx.debug(
          `fetchLiveInfoFromProfile: returned ${page.html.length} bytes (${page.baseUrl}), first 300: ${page.html.slice(0, 300).replace(/\n/g, "\\n")}`,
        )
        const { userId, roomId } = extractUserFromUniversalData(page.html)
        if (!userId) return null

        // If roomId is embedded in the profile page, the user is live.
        // Use room/info which works reliably for both live and offline rooms.
        if (roomId) {
          return ctx.webcast.fetchRoomInfoFromRoomApi(roomId)
        }

        // No roomId means the user is offline (room/enter was unreliable).
        return null
      } catch {
        ctx.flagError()
        return null
      }
    },
  }
}
