import type { RoomRef } from "../../../domain/verdict"
import type { SigiState } from "../parse"
import {
  extractSigiState,
  extractStreamUrlFast,
  extractUserFromUniversalData,
  findStreamUrlRecursively,
} from "../parse"
import { fromRoomInfo, miss, withStream } from "./candidates"
import { fetchSigiLegacy } from "./sigi-legacy"
import type { Candidate, DiscoverySource, ResolveContext } from "./types"

/**
 * Page source: server-rendered SIGI_STATE first, then the async-loaded legacy
 * module, then `__UNIVERSAL_DATA_FOR_REHYDRATION__`. Throws propagate to the
 * chain, which records them and moves on — never a dead end.
 */
export function createPageSource(): DiscoverySource {
  return {
    id: "page",
    async find(ctx: ResolveContext): Promise<Candidate> {
      let sigi: SigiState | null = null
      let html = ""
      // A `failed` sub-step is not terminal: legacy + universal-data fallbacks
      // still get their chance. It is returned only if nothing else hit.
      let failure: Extract<Candidate, { kind: "failed" }> | null = null
      const take = (candidate: Candidate): Candidate | null => {
        if (candidate.kind === "room" || candidate.kind === "denied") return candidate
        if (candidate.kind === "failed") failure ??= candidate
        return null
      }

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
            const room: RoomRef = {
              id: String(userInfo.roomId),
              title: liveRoom.title ?? null,
              live: liveRoom.status === 2, // 2 = live, 4 = offline
            }
            ctx.debug(
              `fetchLiveInfo: primary path — roomId=${room.id}, status=${liveRoom.status}, live=${room.live}`,
            )
            if (!room.live) return { kind: "room", room, stream: null, source: "sigi" }

            // Extract stream URL: try SIGI_STATE first, then Webcast API fallback
            const knownUrl = extractStreamUrlFast(liveRoom) ?? findStreamUrlRecursively(sigi)
            return withStream(ctx, room, "sigi", knownUrl)
          }

          // ── Fallback: userInfo has roomId, but liveRoom is async-loaded ──
          // TikTok may omit liveRoom from the server-rendered page and load it
          // via JavaScript. Query the Webcast API directly — it's authoritative.
          if (userInfo?.roomId) {
            const roomId = String(userInfo.roomId)
            ctx.debug(`fetchLiveInfo: userInfo fallback — roomId=${roomId}, querying Webcast API`)
            const found = take(await fromRoomInfo(ctx, roomId, "room-info"))
            ctx.debug(
              `fetchLiveInfo: Webcast API ${found ? "returned room info" : "returned null"}`,
            )
            if (found) return found
          }

          // ── Legacy fallback: async-loaded SIGI_STATE ──
          ctx.debug("fetchLiveInfo: trying legacy fallback (UserModule)")
          const legacy = take(await fetchSigiLegacy(sigi, ctx))
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
        const found = take(await fromRoomInfo(ctx, roomId, "room-info"))
        ctx.debug(
          `fetchLiveInfo: universal data Webcast API ${found ? "succeeded" : "returned null"}`,
        )
        if (found) return found
      }
      return failure ?? miss("page: no room id")
    },
  }
}
