/**
 * Fallback sources tried after the page: TikTok's own `/api-live/` endpoint,
 * then the profile page's universal data. Both are thin, both fail into
 * `miss`/`failed` so the chain keeps its evidence trail.
 */

import type { RoomRef } from "../../../core/verdict"
import { extractUserFromUniversalData } from "../parse"
import {
  type Candidate,
  type DiscoverySource,
  failed,
  fromRoomInfo,
  miss,
  type ResolveContext,
  withStream,
} from "./chain"

export function createApiLiveSource(): DiscoverySource {
  return {
    id: "api-live",
    async find(ctx: ResolveContext): Promise<Candidate> {
      try {
        const url = `https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=${encodeURIComponent(ctx.user)}&sourceType=54`
        const res = await ctx.http.get(url)
        ctx.debug(`fetchLiveInfoFromApi: ${url} status=${res.status}`)
        if (!res.ok) return miss(`api-live HTTP ${res.status}`)

        const text = await res.text()
        ctx.debug(`fetchLiveInfoFromApi: returned ${text.length} bytes`)
        if (text.length === 0) return miss("api-live: empty body")

        const data = JSON.parse(text) as Record<string, unknown>
        const userData = (data?.data as Record<string, unknown> | undefined)?.user as
          | { roomId?: string; status?: number; uniqueId?: string }
          | undefined

        if (!userData?.roomId) {
          ctx.debug("fetchLiveInfoFromApi: no roomId in API response")
          return miss("api-live: no roomId")
        }

        // status: 2 = live, 4 = offline, 1 = ...
        const room: RoomRef = {
          id: String(userData.roomId),
          title: null,
          live: userData.status === 2,
        }
        ctx.debug(
          `fetchLiveInfoFromApi: roomId=${room.id}, status=${userData.status}, live=${room.live}`,
        )

        if (!room.live) return { kind: "room", room, stream: null, source: "api-live" }
        return withStream(ctx, room, "api-live", null)
      } catch (error) {
        return failed(error)
      }
    },
  }
}

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
