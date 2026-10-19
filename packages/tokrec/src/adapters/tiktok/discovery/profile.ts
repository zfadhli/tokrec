import { extractUserFromUniversalData } from "../parse"
import { failed, fromRoomInfo, miss } from "./candidates"
import type { Candidate, DiscoverySource, ResolveContext } from "./types"

export function createProfileSource(): DiscoverySource {
  return {
    id: "profile",
    async find(ctx: ResolveContext): Promise<Candidate> {
      try {
        const page = await ctx.fetchPage(ctx.user, "")
        if (!page) {
          ctx.debug("fetchLiveInfoFromProfile: all domains blocked for profile page")
          return miss("profile: page blocked")
        }
        ctx.debug(
          `fetchLiveInfoFromProfile: returned ${page.html.length} bytes (${page.baseUrl}), first 300: ${page.html.slice(0, 300).replace(/\n/g, "\\n")}`,
        )
        const { userId, roomId } = extractUserFromUniversalData(page.html)
        if (!userId) return miss("profile: no universal data")
        // No roomId means the user is offline (room/enter was unreliable).
        if (!roomId) return miss("profile: user offline")

        // If roomId is embedded in the profile page, the user is live.
        // Use room/info which works reliably for both live and offline rooms.
        return fromRoomInfo(ctx, roomId, "room-info")
      } catch (error) {
        return failed(error)
      }
    },
  }
}
