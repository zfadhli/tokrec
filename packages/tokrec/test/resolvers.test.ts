/**
 * Per-source unit tests for the resolver chain (`core/api/resolvers/*`).
 *
 * Each source is exercised directly with a hand-built `ResolveContext`
 * (real `createPageFetcher` + real `createWebcastApi` over `createMockHttp`,
 * `flagError` stubbed with a counter). Fixtures are read-only.
 */

import { describe, expect, test } from "bun:test"
import { createApiLiveSource } from "../src/adapters/tiktok/discovery/api-live"
import { createPageSource } from "../src/adapters/tiktok/discovery/page"
import { createProfileSource } from "../src/adapters/tiktok/discovery/profile"
import type { ResolveContext } from "../src/adapters/tiktok/discovery/types"
import { createPageFetcher } from "../src/adapters/tiktok/page"
import { createWebcastApi } from "../src/adapters/tiktok/webcast"
import type { HttpClient } from "../src/ports/http"
import { createMockHttp, loadFixture } from "./utils/mock-http"

const FIXTURES = "tiktok"
const RESTRICTED_ROOM_ID = "7696184043282287367"

/** SIGI page: live status but no stream data → forces the room/info path. */
function buildLiveHtmlWithoutStreamData(): string {
  const sigi = {
    LiveRoom: {
      liveRoomUserInfo: {
        user: { roomId: RESTRICTED_ROOM_ID },
        liveRoom: { status: 2, title: "restricted live" },
      },
    },
  }
  return `<html><head><script id="SIGI_STATE" type="application/json">${JSON.stringify(sigi)}</script></head><body>${"x".repeat(6000)}</body></html>`
}

/** Universal-data page: no SIGI, roomId carried in `webapp.user-detail`. Padded past the WAF size heuristic. */
function buildUniversalHtml(userId: string, roomId: string | null): string {
  const user: Record<string, string> = { id: userId }
  if (roomId) user.roomId = roomId
  const data = { __DEFAULT_SCOPE__: { "webapp.user-detail": { userInfo: { user } } } }
  return `<html><head><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></head><body>${"x".repeat(6000)}</body></html>`
}

function buildCtx(user: string, http: HttpClient, flagError: () => void): ResolveContext {
  const debug = (_msg: string) => {}
  return {
    user,
    http,
    debug,
    fetchPage: createPageFetcher(http, debug),
    webcast: createWebcastApi(http, debug, flagError),
    flagError,
  }
}

describe("createPageSource", () => {
  test("restricted: SIGI live without streamData + room/info 4003110 + check_alive true", async () => {
    let flags = 0
    const http = createMockHttp({
      "https://www.tiktok.com/@restricteduser/live": buildLiveHtmlWithoutStreamData(),
      "https://webcast.tiktok.com/webcast/room/info/": loadFixture(
        FIXTURES,
        "room-info-restricted.json",
      ),
      "https://webcast.tiktok.com/webcast/room/check_alive/": loadFixture(
        FIXTURES,
        "check-alive-live.json",
      ),
    })
    const info = await createPageSource().resolve(
      buildCtx("restricteduser", http, () => {
        flags++
      }),
    )
    expect(info).not.toBeNull()
    expect(info?.roomId).toBe(RESTRICTED_ROOM_ID)
    expect(info?.isLive).toBe(true)
    expect(info?.streamUrl).toBeNull()
    expect(info?.reason).toBe("restricted")
    expect(info?.source).toBe("sigi")
    expect(flags).toBe(0)
    await http.close()
  })

  test("offline: same refused room but check_alive false", async () => {
    let flags = 0
    const http = createMockHttp({
      "https://www.tiktok.com/@restricteduser/live": buildLiveHtmlWithoutStreamData(),
      "https://webcast.tiktok.com/webcast/room/info/": loadFixture(
        FIXTURES,
        "room-info-restricted.json",
      ),
      "https://webcast.tiktok.com/webcast/room/check_alive/": loadFixture(
        FIXTURES,
        "check-alive-offline.json",
      ),
    })
    const info = await createPageSource().resolve(
      buildCtx("restricteduser", http, () => {
        flags++
      }),
    )
    expect(info).not.toBeNull()
    expect(info?.roomId).toBe(RESTRICTED_ROOM_ID)
    expect(info?.isLive).toBe(false)
    expect(info?.streamUrl).toBeNull()
    expect(info?.reason).toBe("offline")
    expect(info?.source).toBe("sigi")
    expect(flags).toBe(0)
    await http.close()
  })

  test("universal data roomId resolves via room/info and emits room-info", async () => {
    const roomId = "7649515096078600981"
    let flags = 0
    const http = createMockHttp({
      "https://www.tiktok.com/@anomaliaa27/live": buildUniversalHtml("7536224525122798648", roomId),
      "https://webcast.tiktok.com/webcast/room/info/": loadFixture(
        FIXTURES,
        "anomaliaa27-room-info.json",
      ),
    })
    const info = await createPageSource().resolve(
      buildCtx("anomaliaa27", http, () => {
        flags++
      }),
    )
    expect(info).not.toBeNull()
    expect(info?.roomId).toBe(roomId)
    expect(info?.isLive).toBe(true)
    expect(info?.reason).toBe("live")
    expect(info?.streamUrl).toMatch(/\.(flv|m3u8)/)
    expect(info?.source).toBe("room-info")
    expect(flags).toBe(0)
    await http.close()
  })
})

describe("createApiLiveSource", () => {
  test("status 4 with roomId maps to offline with roomId kept", async () => {
    const roomId = "7696112012440324885"
    let flags = 0
    const http = createMockHttp({
      "https://www.tiktok.com/api-live/user/room/": JSON.stringify({
        data: { user: { roomId, status: 4 } },
      }),
    })
    const info = await createApiLiveSource().resolve(
      buildCtx("offlineuser", http, () => {
        flags++
      }),
    )
    expect(info).not.toBeNull()
    expect(info?.roomId).toBe(roomId)
    expect(info?.isLive).toBe(false)
    expect(info?.streamUrl).toBeNull()
    expect(info?.reason).toBe("offline")
    expect(info?.source).toBe("api-live")
    expect(flags).toBe(0)
    await http.close()
  })

  test("transport failure returns null and flags exactly once", async () => {
    // A 404 alone returns null *without* flagging (by design: `!res.ok`
    // short-circuits before JSON.parse), so a true transport failure is a
    // throwing client — that is what exercises the internal catch.
    let flags = 0
    const base = createMockHttp({})
    const http: HttpClient = {
      ...base,
      get: async (_url: string): Promise<Response> => {
        throw new Error("transport boom")
      },
    }
    const info = await createApiLiveSource().resolve(
      buildCtx("anyuser", http, () => {
        flags++
      }),
    )
    expect(info).toBeNull()
    expect(flags).toBe(1)
    await http.close()
  })
})

describe("createProfileSource", () => {
  test("universal data with userId but no roomId returns null without flagging", async () => {
    let flags = 0
    const http = createMockHttp({
      "https://www.tiktok.com/@naylaarindinta": loadFixture(
        FIXTURES,
        "naylaarindinta-profile.html",
      ),
    })
    const info = await createProfileSource().resolve(
      buildCtx("naylaarindinta", http, () => {
        flags++
      }),
    )
    expect(info).toBeNull()
    expect(flags).toBe(0)
    await http.close()
  })

  test("profile page carrying roomId resolves via room/info and emits room-info", async () => {
    const roomId = "7649515096078600981"
    let flags = 0
    const http = createMockHttp({
      "https://www.tiktok.com/@anomaliaa27": buildUniversalHtml("7536224525122798648", roomId),
      "https://webcast.tiktok.com/webcast/room/info/": loadFixture(
        FIXTURES,
        "anomaliaa27-room-info.json",
      ),
    })
    const info = await createProfileSource().resolve(
      buildCtx("anomaliaa27", http, () => {
        flags++
      }),
    )
    expect(info).not.toBeNull()
    expect(info?.roomId).toBe(roomId)
    expect(info?.isLive).toBe(true)
    expect(info?.reason).toBe("live")
    expect(info?.streamUrl).toMatch(/\.(flv|m3u8)/)
    expect(info?.source).toBe("room-info")
    expect(flags).toBe(0)
    await http.close()
  })
})

describe("source names", () => {
  test("each factory name is unique", () => {
    const names = [createPageSource().name, createApiLiveSource().name, createProfileSource().name]
    expect(names).toEqual(["page", "api-live", "profile"])
    expect(new Set(names).size).toBe(names.length)
  })

  test("api-live emits its own name as source", async () => {
    const roomId = "7696112012440324885"
    let flags = 0
    const http = createMockHttp({
      "https://www.tiktok.com/api-live/user/room/": JSON.stringify({
        data: { user: { roomId, status: 4 } },
      }),
    })
    const source = createApiLiveSource()
    const info = await source.resolve(
      buildCtx("offlineuser", http, () => {
        flags++
      }),
    )
    expect(info?.source).toBe(source.name)
    expect(flags).toBe(0)
    await http.close()
  })
})
