/**
 * Per-source unit tests for the discovery chain (`adapters/tiktok/discovery/*`).
 *
 * Each source is exercised directly with a hand-built `ResolveContext`
 * (real `createPageFetcher` + real `createWebcastApi` over `createMockHttp`).
 * Sources now return `Candidate`s — the verdict mapping is `verdictOf`'s job
 * and is table-tested in `verdict.test.ts`. Fixtures are read-only.
 */

import { describe, expect, test } from "bun:test"
import type { HttpClient } from "../src/io/http"
import {
  type Candidate,
  type DiscoverySource,
  discover,
  type ResolveContext,
} from "../src/io/tiktok/discovery/chain"
import { createApiLiveSource, createProfileSource } from "../src/io/tiktok/discovery/fallback"
import { createPageSource } from "../src/io/tiktok/discovery/page"
import { createPageFetcher } from "../src/io/tiktok/page"
import { createWebcastApi } from "../src/io/tiktok/webcast"
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

function buildCtx(user: string, http: HttpClient): ResolveContext {
  const debug = (_msg: string) => {}
  return {
    user,
    http,
    debug,
    fetchPage: createPageFetcher(http, debug),
    webcast: createWebcastApi(http, debug),
  }
}

function roomOf(candidate: Candidate) {
  if (candidate.kind !== "room") throw new Error(`expected room, got ${candidate.kind}`)
  return candidate
}

function deniedOf(candidate: Candidate) {
  if (candidate.kind !== "denied") throw new Error(`expected denied, got ${candidate.kind}`)
  return candidate
}

describe("createPageSource", () => {
  test("restricted: SIGI live without streamData + room/info 4003110 + check_alive true", async () => {
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
    const candidate = deniedOf(await createPageSource().find(buildCtx("restricteduser", http)))
    expect(candidate.room.id).toBe(RESTRICTED_ROOM_ID)
    expect(candidate.room.live).toBe(true)
    expect(candidate.room.title).toBe("restricted live")
    expect(candidate.source).toBe("sigi")
    expect(candidate.code).toBe(4003110)
    await http.close()
  })

  test("offline: same refused room but check_alive false", async () => {
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
    const candidate = deniedOf(await createPageSource().find(buildCtx("restricteduser", http)))
    expect(candidate.room.id).toBe(RESTRICTED_ROOM_ID)
    expect(candidate.room.live).toBe(false)
    expect(candidate.source).toBe("sigi")
    await http.close()
  })

  test("universal data roomId resolves via room/info and emits room-info", async () => {
    const roomId = "7649515096078600981"
    const http = createMockHttp({
      "https://www.tiktok.com/@anomaliaa27/live": buildUniversalHtml("7536224525122798648", roomId),
      "https://webcast.tiktok.com/webcast/room/info/": loadFixture(
        FIXTURES,
        "anomaliaa27-room-info.json",
      ),
    })
    const candidate = roomOf(await createPageSource().find(buildCtx("anomaliaa27", http)))
    expect(candidate.room.id).toBe(roomId)
    expect(candidate.room.live).toBe(true)
    expect(candidate.stream?.url).toMatch(/\.(flv|m3u8)/)
    expect(candidate.source).toBe("room-info")
    await http.close()
  })
})

describe("createApiLiveSource", () => {
  test("status 4 with roomId maps to an offline room candidate", async () => {
    const roomId = "7696112012440324885"
    const http = createMockHttp({
      "https://www.tiktok.com/api-live/user/room/": JSON.stringify({
        data: { user: { roomId, status: 4 } },
      }),
    })
    const candidate = roomOf(await createApiLiveSource().find(buildCtx("offlineuser", http)))
    expect(candidate.room.id).toBe(roomId)
    expect(candidate.room.live).toBe(false)
    expect(candidate.stream).toBeNull()
    expect(candidate.source).toBe("api-live")
    await http.close()
  })

  test("transport failure returns a failed candidate carrying the error", async () => {
    // A 404 alone is a miss (by design: `!res.ok` short-circuits before
    // JSON.parse), so a true transport failure is a throwing client.
    const base = createMockHttp({})
    const http: HttpClient = {
      ...base,
      get: async (_url: string): Promise<Response> => {
        throw new Error("transport boom")
      },
    }
    const candidate = await createApiLiveSource().find(buildCtx("anyuser", http))
    expect(candidate.kind).toBe("failed")
    if (candidate.kind === "failed") expect(candidate.error.message).toBe("transport boom")
    await http.close()
  })
})

describe("createProfileSource", () => {
  test("universal data with userId but no roomId is a miss", async () => {
    const http = createMockHttp({
      "https://www.tiktok.com/@naylaarindinta": loadFixture(
        FIXTURES,
        "naylaarindinta-profile.html",
      ),
    })
    const candidate = await createProfileSource().find(buildCtx("naylaarindinta", http))
    expect(candidate.kind).toBe("miss")
    await http.close()
  })

  test("profile page carrying roomId resolves via room/info and emits room-info", async () => {
    const roomId = "7649515096078600981"
    const http = createMockHttp({
      "https://www.tiktok.com/@anomaliaa27": buildUniversalHtml("7536224525122798648", roomId),
      "https://webcast.tiktok.com/webcast/room/info/": loadFixture(
        FIXTURES,
        "anomaliaa27-room-info.json",
      ),
    })
    const candidate = roomOf(await createProfileSource().find(buildCtx("anomaliaa27", http)))
    expect(candidate.room.id).toBe(roomId)
    expect(candidate.room.live).toBe(true)
    expect(candidate.stream?.url).toMatch(/\.(flv|m3u8)/)
    expect(candidate.source).toBe("room-info")
    await http.close()
  })
})

describe("discover", () => {
  const ctx = { debug: () => {} } as unknown as ResolveContext

  test("a failed source outranks a later miss", async () => {
    const sources: DiscoverySource[] = [
      { id: "page", find: async () => ({ kind: "failed", error: new Error("boom") }) },
      { id: "profile", find: async () => ({ kind: "miss", note: "nope" }) },
    ]
    const { candidate, evidence } = await discover(sources, ctx)
    expect(candidate.kind).toBe("failed")
    expect(evidence).toEqual([
      { source: "page", outcome: "error" },
      { source: "profile", outcome: "miss" },
    ])
  })

  test("a synchronously throwing source fails instead of rejecting discover", async () => {
    const sources: DiscoverySource[] = [
      {
        id: "page",
        find: (() => {
          throw new Error("sync boom")
        }) as DiscoverySource["find"],
      },
    ]
    const { candidate } = await discover(sources, ctx)
    expect(candidate.kind).toBe("failed")
    if (candidate.kind === "failed") expect(candidate.error.message).toBe("sync boom")
  })

  test("the first failure is kept as the root cause", async () => {
    const sources: DiscoverySource[] = [
      { id: "page", find: async () => ({ kind: "failed", error: new Error("first") }) },
      { id: "api-live", find: async () => ({ kind: "failed", error: new Error("second") }) },
    ]
    const { candidate } = await discover(sources, ctx)
    expect(candidate.kind).toBe("failed")
    if (candidate.kind === "failed") expect(candidate.error.message).toBe("first")
  })
})

describe("source ids", () => {
  test("each factory id is unique", () => {
    const ids = [createPageSource().id, createApiLiveSource().id, createProfileSource().id]
    expect(ids).toEqual(["page", "api-live", "profile"])
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("api-live emits its own id as candidate source", async () => {
    const roomId = "7696112012440324885"
    const http = createMockHttp({
      "https://www.tiktok.com/api-live/user/room/": JSON.stringify({
        data: { user: { roomId, status: 4 } },
      }),
    })
    const source = createApiLiveSource()
    const candidate = roomOf(await source.find(buildCtx("offlineuser", http)))
    expect(candidate.source).toBe(source.id)
    await http.close()
  })
})
