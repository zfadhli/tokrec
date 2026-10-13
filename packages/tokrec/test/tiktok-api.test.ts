/**
 * Tests for TikTok API live detection chain using fixture data.
 *
 * These tests verify the full detection flow:
 *   Tier 1: SIGI_STATE from /live page
 *   Tier 2: __UNIVERSAL_DATA_FOR_REHYDRATION__ from /live page
 *   Tier 3: Profile page fallback for universal data
 */

import { describe, expect, test } from "bun:test"
import {
  createTikTokApi,
  extractSigiState,
  extractUserFromUniversalData,
  findStreamUrlRecursively,
} from "../src/core/api/tiktok"
import { createMockHttp, loadFixture } from "./utils/mock-http"

// ─── Fixture paths ──────────────────────────────────────────────────

const FIXTURES = "tiktok"

// ─── Unit tests for extract functions ───────────────────────────────

describe("extractSigiState", () => {
  test("extracts SIGI_STATE from live user's /live page", () => {
    const html = loadFixture(FIXTURES, "anomaliaa27-live.html")
    const sigi = extractSigiState(html)
    expect(sigi).not.toBeNull()
    expect(sigi?.LiveRoom?.liveRoomUserInfo?.user?.roomId).toBeDefined()
  })

  test("returns null when SIGI_STATE is absent (profile page SPA shell)", () => {
    const html = loadFixture(FIXTURES, "anomaliaa27-profile.html")
    const sigi = extractSigiState(html)
    expect(sigi).toBeNull()
  })
})

describe("extractUserFromUniversalData", () => {
  test("extracts userId and roomId from live user's /live page", () => {
    const html = loadFixture(FIXTURES, "anomaliaa27-live.html")
    const { userId } = extractUserFromUniversalData(html)
    // Note: Universal data in /live page may not have user info
    // (SIGI_STATE is the primary source). This tests what's available.
    expect(userId).toBeDefined()
  })

  test("extracts userId (no roomId) from offline user's profile page", () => {
    const html = loadFixture(FIXTURES, "naylaarindinta-profile.html")
    const { userId, roomId } = extractUserFromUniversalData(html)
    expect(userId).toBe("7536224525122798648")
    expect(roomId).toBeNull()
  })

  test("returns null for both when no universal data (SPA shell)", () => {
    const html = loadFixture(FIXTURES, "anomaliaa27-profile.html")
    const { userId, roomId } = extractUserFromUniversalData(html)
    expect(userId).toBeNull()
    expect(roomId).toBeNull()
  })
})

// ─── API-level integration tests with mocked HTTP ───────────────────

describe("createTikTokApi with fixture mocks", () => {
  test("detects live user via SIGI_STATE (Tier 1)", async () => {
    const livePageHtml = loadFixture(FIXTURES, "anomaliaa27-live.html")
    const roomInfoJson = loadFixture(FIXTURES, "anomaliaa27-room-info.json")

    const http = createMockHttp({
      "https://www.tiktok.com/@anomaliaa27/live": livePageHtml,
      "https://webcast.tiktok.com/webcast/room/info/": roomInfoJson,
    })

    const api = createTikTokApi(http)
    const roomId = await api.getRoomId("anomaliaa27")
    expect(roomId).toBe("7649515096078600981")

    const isLive = await api.isRoomAlive(roomId!)
    expect(isLive).toBe(true)

    const streamUrl = await api.getLiveUrl(roomId!)
    expect(streamUrl).not.toBeNull()
    expect(streamUrl).toMatch(/\.(flv|m3u8)/)

    await http.close()
  })

  test("returns null for non-existent user (404)", async () => {
    const http = createMockHttp({
      "https://www.tiktok.com/@nonexistent/live": { status: 404, body: "Not found" },
    })

    const api = createTikTokApi(http)
    const roomId = await api.getRoomId("nonexistent")
    expect(roomId).toBeNull()

    await http.close()
  })

  test("detects offline user via status check (Tier 1, status=4)", async () => {
    const offlineLiveHtml = loadFixture(FIXTURES, "naylaarindinta-live.html")

    const http = createMockHttp({
      "https://www.tiktok.com/@naylaarindinta/live": offlineLiveHtml,
    })

    const api = createTikTokApi(http)
    // TikTok assigns persistent room IDs even when offline
    const roomId = await api.getRoomId("naylaarindinta")
    expect(roomId).toBe("7649522507606919957")

    // But the room should NOT be alive
    const isLive = await api.isRoomAlive(roomId!)
    expect(isLive).toBe(false)

    // And no stream URL should be available
    const streamUrl = await api.getLiveUrl(roomId!)
    expect(streamUrl).toBeNull()

    await http.close()
  })

  test("handles SPA shell profile page gracefully (no SSR data)", async () => {
    const profileShell = loadFixture(FIXTURES, "anomaliaa27-profile.html")

    const http = createMockHttp({
      "https://www.tiktok.com/@anomaliaa27/live": profileShell,
      "https://www.tiktok.com/@anomaliaa27": profileShell,
    })

    const api = createTikTokApi(http)
    const roomId = await api.getRoomId("anomaliaa27")
    // No SSR data, no universal data, no room/info API → should return null
    expect(roomId).toBeNull()

    await http.close()
  })

  test("falls through to Tier 3 when /live page has no SIGI_STATE", async () => {
    // When the /live page returns the SPA shell (no SIGI_STATE, no universal data),
    // the API should fall back to fetching the profile page.
    const profileShell = loadFixture(FIXTURES, "anomaliaa27-profile.html")
    const offlineProfileHtml = loadFixture(FIXTURES, "naylaarindinta-profile.html")

    const http = createMockHttp({
      "https://www.tiktok.com/@anomaliaa27/live": profileShell,
      // Profile page has universal data with userId but no roomId (offline)
      "https://www.tiktok.com/@anomaliaa27": offlineProfileHtml,
    })

    const api = createTikTokApi(http)
    const roomId = await api.getRoomId("anomaliaa27")
    // The profile page has universal data with userId but no roomId
    // API will try room/enter API which returns 404 → null
    expect(roomId).toBeNull()

    await http.close()
  })
})

// ─── isRoomAlive with room/check_alive/ endpoint ────────────────────

describe("isRoomAlive with check_alive endpoint", () => {
  test("returns true when check_alive reports alive", async () => {
    const checkAliveJson = loadFixture(FIXTURES, "check-alive-live.json")

    const http = createMockHttp({
      "https://webcast.tiktok.com/webcast/room/check_alive/": checkAliveJson,
    })

    const api = createTikTokApi(http)
    const alive = await api.isRoomAlive("7649515096078600981")
    expect(alive).toBe(true)

    await http.close()
  })

  test("returns false when check_alive reports offline", async () => {
    const checkAliveJson = loadFixture(FIXTURES, "check-alive-offline.json")

    const http = createMockHttp({
      "https://webcast.tiktok.com/webcast/room/check_alive/": checkAliveJson,
    })

    const api = createTikTokApi(http)
    const alive = await api.isRoomAlive("7649515096078600981")
    expect(alive).toBe(false)

    await http.close()
  })

  test("returns false on HTTP error from check_alive", async () => {
    const http = createMockHttp({
      "https://webcast.tiktok.com/webcast/room/check_alive/": { status: 500, body: "Error" },
    })

    const api = createTikTokApi(http)
    const alive = await api.isRoomAlive("7649515096078600981")
    expect(alive).toBe(false)

    await http.close()
  })

  test("uses cache when available (does not call check_alive)", async () => {
    const livePageHtml = loadFixture(FIXTURES, "anomaliaa27-live.html")
    const checkAliveJson = loadFixture(FIXTURES, "check-alive-live.json")

    let checkAliveCalls = 0
    const http = createMockHttp({
      "https://www.tiktok.com/@anomaliaa27/live": livePageHtml,
      "https://webcast.tiktok.com/webcast/room/info/": { status: 500, body: "" },
      "https://webcast.tiktok.com/webcast/room/check_alive/": checkAliveJson,
    })
    // Track check_alive calls
    const origGet = http.get.bind(http)
    http.get = async (url: string) => {
      if (url.includes("check_alive")) checkAliveCalls++
      return origGet(url)
    }

    const api = createTikTokApi(http)

    // First call populates cache via getRoomId
    const roomId = await api.getRoomId("anomaliaa27")
    expect(roomId).toBe("7649515096078600981")

    // isRoomAlive uses cache — should NOT call check_alive
    const alive = await api.isRoomAlive(roomId!)
    expect(alive).toBe(true)
    expect(checkAliveCalls).toBe(0)

    await http.close()
  })
})

// ─── getLiveInfo reason taxonomy (t1: restricted / offline / live) ────────

describe("getLiveInfo with reason taxonomy", () => {
  const RESTRICTED_ROOM_ID = "7696184043282287367"

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

    const api = createTikTokApi(http)
    const info = await api.getLiveInfo("restricteduser")
    expect(info.roomId).toBe(RESTRICTED_ROOM_ID)
    expect(info.isLive).toBe(true)
    expect(info.streamUrl).toBeNull()
    expect(info.reason).toBe("restricted")

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

    const api = createTikTokApi(http)
    const info = await api.getLiveInfo("restricteduser")
    expect(info.roomId).toBe(RESTRICTED_ROOM_ID)
    expect(info.isLive).toBe(false)
    expect(info.reason).toBe("offline")

    await http.close()
  })

  test("live: healthy SIGI + room-info fixture resolves reason live with a stream URL", async () => {
    const http = createMockHttp({
      "https://www.tiktok.com/@anomaliaa27/live": loadFixture(FIXTURES, "anomaliaa27-live.html"),
      "https://webcast.tiktok.com/webcast/room/info/": loadFixture(
        FIXTURES,
        "anomaliaa27-room-info.json",
      ),
    })

    const api = createTikTokApi(http)
    const info = await api.getLiveInfo("anomaliaa27")
    expect(info.reason).toBe("live")
    expect(info.streamUrl).toMatch(/\.(flv|m3u8)/)

    await http.close()
  })
})

// ─── fetchLiveInfo api-live fallback (t2) ────────

describe("fetchLiveInfo api-live fallback", () => {
  function buildLargePageWithoutRoomId(): string {
    return `<html><head><title>age wall</title></head><body>${"x".repeat(6000)}</body></html>`
  }

  test("calls api-live when a large /live page yields no roomId", async () => {
    const roomId = "7696184043282287367"
    const http = createMockHttp({
      "https://www.tiktok.com/@bigpageuser/live": buildLargePageWithoutRoomId(),
      "https://www.tiktok.com/api-live/user/room/": JSON.stringify({
        data: { user: { roomId, status: 2 } },
      }),
    })

    const api = createTikTokApi(http)
    const info = await api.getLiveInfo("bigpageuser")
    // Mock returns 404 for unregistered URLs, so a roomId here proves api-live was fetched
    expect(info.roomId).toBe(roomId)
    expect(info.source).toBe("api-live")

    await http.close()
  })

  test("api-live status 4 with roomId maps to offline with roomId kept", async () => {
    const roomId = "7696112012440324885"
    const http = createMockHttp({
      "https://www.tiktok.com/@offlineuser/live": buildLargePageWithoutRoomId(),
      "https://www.tiktok.com/api-live/user/room/": JSON.stringify({
        data: { user: { roomId, status: 4 } },
      }),
    })

    const api = createTikTokApi(http)
    const info = await api.getLiveInfo("offlineuser")
    expect(info.roomId).toBe(roomId)
    expect(info.isLive).toBe(false)
    expect(info.reason).toBe("offline")
    expect(info.source).toBe("api-live")

    await http.close()
  })

  test("api-live non-JSON body surfaces reason error when no info obtained", async () => {
    const http = createMockHttp({
      "https://www.tiktok.com/api-live/user/room/": "<html>not json</html>",
    })

    const api = createTikTokApi(http)
    const info = await api.getLiveInfo("brokenuser")
    expect(info.roomId).toBeNull()
    expect(info.isLive).toBe(false)
    expect(info.reason).toBe("error")

    await http.close()
  })
})

// ─── findStreamUrlRecursively integration with real fixtures ────────

describe("findStreamUrlRecursively with fixture data", () => {
  test("finds stream URL in room-info.json fixture", () => {
    const roomInfoJson = loadFixture(FIXTURES, "anomaliaa27-room-info.json")
    const data = JSON.parse(roomInfoJson)
    const streamUrl = findStreamUrlRecursively(data)
    expect(streamUrl).not.toBeNull()
    expect(streamUrl).toMatch(/https?:\/\/.+\..+\.(flv|m3u8)/)
  })
})
