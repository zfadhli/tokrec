import type { LiveInfo, ResolveContext, RoomSource } from "./types"

export function createApiLiveSource(): RoomSource {
  return {
    name: "api-live",
    async resolve(ctx: ResolveContext): Promise<LiveInfo | null> {
      try {
        const url = `https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=${encodeURIComponent(ctx.user)}&sourceType=54`
        const res = await ctx.http.get(url)
        ctx.debug(`fetchLiveInfoFromApi: ${url} status=${res.status}`)
        if (!res.ok) return null

        const text = await res.text()
        ctx.debug(`fetchLiveInfoFromApi: returned ${text.length} bytes`)
        if (text.length === 0) return null

        const data = JSON.parse(text) as Record<string, unknown>
        const userData = (data?.data as Record<string, unknown> | undefined)?.user as
          | { roomId?: string; status?: number; uniqueId?: string }
          | undefined

        if (!userData?.roomId) {
          ctx.debug("fetchLiveInfoFromApi: no roomId in API response")
          return null
        }

        const roomId = String(userData.roomId)
        // status: 2 = live, 4 = offline, 1 = ...
        const isLive = userData.status === 2
        ctx.debug(
          `fetchLiveInfoFromApi: roomId=${roomId}, status=${userData.status}, isLive=${isLive}`,
        )

        if (!isLive) {
          return {
            roomId,
            isLive: false,
            streamUrl: null,
            title: null,
            reason: "offline",
            source: "api-live",
          }
        }

        // Query Webcast API for stream URL
        const streamRes = await ctx.webcast.fetchStreamUrlFromApi(roomId)
        if (streamRes.ok) {
          if (streamRes.value) {
            return {
              roomId,
              isLive: true,
              streamUrl: streamRes.value,
              title: null,
              reason: "live",
              source: "api-live",
            }
          }
          return {
            roomId,
            isLive: true,
            streamUrl: null,
            title: null,
            reason: "no-stream-url",
            source: "api-live",
          }
        }
        if (streamRes.statusCode === 4003110) {
          return ctx.webcast.resolveRefusedRoom(roomId, "api-live", null)
        }
        return {
          roomId,
          isLive: true,
          streamUrl: null,
          title: null,
          reason: "no-stream-url",
          source: "api-live",
        }
      } catch {
        ctx.flagError()
        return null
      }
    },
  }
}
