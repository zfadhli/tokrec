import type { RoomRef } from "../../../domain/verdict"
import { failed, miss, withStream } from "./candidates"
import type { Candidate, DiscoverySource, ResolveContext } from "./types"

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
