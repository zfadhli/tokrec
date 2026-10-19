import type { LiveInfo } from "../../../domain/verdict"
import type { SigiState } from "../parse"
import {
  extractSigiState,
  extractStreamUrlFast,
  extractUserFromUniversalData,
  findStreamUrlRecursively,
} from "../parse"
import { fetchSigiLegacy } from "./sigi-legacy"
import type { ResolveContext, RoomSource } from "./types"

export function createPageSource(): RoomSource {
  return {
    name: "page",
    async resolve(ctx: ResolveContext): Promise<LiveInfo | null> {
      let sigi: SigiState | null = null
      let html = ""

      const page = await ctx.fetchPage(ctx.user, "/live")
      if (!page) {
        ctx.debug("fetchLiveInfo: all domains blocked for /live page")
        // Fall through to universal data / profile page fallback
        html = ""
      } else {
        html = page.html
        ctx.debug(
          `fetchLiveInfo: /live returned ${html.length} bytes (${page.baseUrl}), first 300: ${html.slice(0, 300).replace(/\n/g, "\\n")}`,
        )

        sigi = extractSigiState(html)
        ctx.debug(`fetchLiveInfo: SIGI_STATE ${sigi ? "found" : "not found"}`)

        if (sigi) {
          const liveRoom = sigi.LiveRoom?.liveRoomUserInfo?.liveRoom
          const userInfo = sigi.LiveRoom?.liveRoomUserInfo?.user

          ctx.debug(
            `fetchLiveInfo: liveRoom=${!!liveRoom}, userInfo=${!!userInfo}, userInfo.roomId=${userInfo?.roomId ?? "null"}`,
          )

          // ── Primary path: liveRoom is populated (server-rendered) ──
          if (liveRoom && userInfo?.roomId) {
            const roomId = String(userInfo.roomId)
            const isLive = liveRoom.status === 2 // 2 = live, 4 = offline
            ctx.debug(
              `fetchLiveInfo: primary path — roomId=${roomId}, status=${liveRoom.status}, isLive=${isLive}`,
            )
            const title = liveRoom.title ?? null
            if (!isLive) {
              return {
                roomId,
                isLive: false,
                streamUrl: null,
                title,
                reason: "offline",
                source: "sigi",
              }
            }

            // Extract stream URL: try SIGI_STATE first, then Webcast API fallback
            let streamUrl = extractStreamUrlFast(liveRoom)
            if (!streamUrl) streamUrl = findStreamUrlRecursively(sigi)
            if (streamUrl) {
              return { roomId, isLive: true, streamUrl, title, reason: "live", source: "sigi" }
            }
            const streamRes = await ctx.webcast.fetchStreamUrlFromApi(roomId)
            if (streamRes.ok) {
              if (streamRes.value) {
                return {
                  roomId,
                  isLive: true,
                  streamUrl: streamRes.value,
                  title,
                  reason: "live",
                  source: "sigi",
                }
              }
              return {
                roomId,
                isLive: true,
                streamUrl: null,
                title,
                reason: "no-stream-url",
                source: "sigi",
              }
            }
            if (streamRes.statusCode === 4003110) {
              return ctx.webcast.resolveRefusedRoom(roomId, "sigi", title)
            }
            return {
              roomId,
              isLive: true,
              streamUrl: null,
              title,
              reason: "no-stream-url",
              source: "sigi",
            }
          }

          // ── Fallback: userInfo has roomId, but liveRoom is async-loaded ──
          // TikTok may omit liveRoom from the server-rendered page and load it
          // via JavaScript. Query the Webcast API directly — it's authoritative.
          if (userInfo?.roomId) {
            const roomId = String(userInfo.roomId)
            ctx.debug(`fetchLiveInfo: userInfo fallback — roomId=${roomId}, querying Webcast API`)
            const roomInfo = await ctx.webcast.fetchRoomInfoFromRoomApi(roomId)
            ctx.debug(
              `fetchLiveInfo: Webcast API ${roomInfo ? "returned room info" : "returned null"}`,
            )
            if (roomInfo) return roomInfo
          }

          // ── Legacy fallback: async-loaded SIGI_STATE ──
          ctx.debug("fetchLiveInfo: trying legacy fallback (UserModule)")
          const legacy = await fetchSigiLegacy(sigi, ctx)
          ctx.debug(`fetchLiveInfo: legacy fallback ${legacy ? "succeeded" : "returned null"}`)
          if (legacy) return legacy
        } // end if (sigi)
      } // end else (page loaded)

      // ── Universal data from the already-fetched /live html ──
      // TikTok migrated from SIGI_STATE to __UNIVERSAL_DATA_FOR_REHYDRATION__.
      // The /live page may not have it, so try the main profile page.
      ctx.debug(`fetchLiveInfo: trying universal data fallback (html length ${html.length})`)
      const { roomId } = extractUserFromUniversalData(html)
      ctx.debug(`fetchLiveInfo: universal data roomId=${roomId ?? "null"}`)
      if (roomId) {
        // If the /live page has the roomId, use room/info (reliable)
        const result = await ctx.webcast.fetchRoomInfoFromRoomApi(roomId)
        ctx.debug(
          `fetchLiveInfo: universal data Webcast API ${result ? "succeeded" : "returned null"}`,
        )
        if (result) return result
      }
      return null
    },
  }
}
