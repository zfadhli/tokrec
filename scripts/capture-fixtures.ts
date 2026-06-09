/**
 * Capture TikTok HTML/API responses as test fixtures.
 * Uses the same HTTP client (wreq-js with TLS fingerprinting + cookies)
 * as the main recorder to ensure authentic responses.
 *
 * Usage: bun run scripts/capture-fixtures.ts
 *
 * Output: test/fixtures/tiktok/<user>/
 *   - live-profile.html  — /@<liveUser> profile page (with __UNIVERSAL_DATA_FOR_REHYDRATION__)
 *   - live-live.html     — /@<liveUser>/live page
 *   - offline-profile.html — /@<offlineUser> profile page
 *   - offline-live.html    — /@<offlineUser>/live page
 *   - room-info.json     — /webcast/room/info/?room_id=<roomId>&type=live
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const FIXTURE_DIR = join(ROOT, "test", "fixtures", "tiktok")

interface Cookies {
  sessionid_ss: string
  "tt-target-idc"?: string
}

async function loadCookies(): Promise<Cookies | null> {
  // Try Firefox first
  try {
    const { extractTikTokCookiesFromFirefox } = await import(
      join(ROOT, "src", "browser-cookies.ts")
    )
    const ff = extractTikTokCookiesFromFirefox()
    if (ff) {
      console.log("Using Firefox cookies")
      return ff
    }
  } catch (e) {
    console.log("Firefox extraction failed:", e)
  }

  // Fall back to cookies.json
  try {
    const { readFileSync } = await import("node:fs")
    const raw = readFileSync(join(ROOT, "cookies.json"), "utf-8")
    const json = JSON.parse(raw)
    if (json?.sessionid_ss) {
      console.log("Using cookies.json")
      return json as Cookies
    }
  } catch (e) {
    console.log("cookies.json loading failed:", e)
  }

  return null
}

async function capture() {
  const cookies = await loadCookies()
  if (!cookies) {
    console.error("No cookies found — cannot capture fixtures")
    process.exit(1)
  }

  const { createHttpClient } = await import(join(ROOT, "src", "api", "client.ts"))
  const config = {
    cookies,
    outputDir: "./recordings",
    interval: 3,
    segmentMinutes: 20,
  }

  const http = await createHttpClient(config as any)

  // Create fixture dir
  if (!existsSync(FIXTURE_DIR)) {
    mkdirSync(FIXTURE_DIR, { recursive: true })
  }

  const liveUser = "anomaliaa27"
  const offlineUser = "naylaarindinta"

  try {
    // ── Live user ──
    console.log(`\nFetching live user: @${liveUser}`)

    // Profile page
    const liveProfileRes = await http.get(`https://www.tiktok.com/@${liveUser}`)
    const liveProfileHtml = await liveProfileRes.text()
    writeFileSync(join(FIXTURE_DIR, `${liveUser}-profile.html`), liveProfileHtml)
    console.log(`  -> Profile page: ${liveProfileHtml.length} bytes`)

    // Live page
    const liveLiveRes = await http.get(`https://www.tiktok.com/@${liveUser}/live`)
    const liveLiveHtml = await liveLiveRes.text()
    writeFileSync(join(FIXTURE_DIR, `${liveUser}-live.html`), liveLiveHtml)
    console.log(`  -> Live page: ${liveLiveHtml.length} bytes`)

    // Check for room ID from SIGI_STATE (live page) or universal data (profile)
    const { extractUserFromUniversalData, extractSigiState } = await import(
      join(ROOT, "src", "api", "tiktok.ts")
    )

    // Try SIGI_STATE first (from /live page)
    const sigi = extractSigiState(liveLiveHtml)
    let liveRoomId: string | null = null
    if (sigi?.LiveRoom?.liveRoomUserInfo?.user?.roomId) {
      liveRoomId = String(sigi.LiveRoom.liveRoomUserInfo.user.roomId)
      console.log(`  -> SIGI_STATE roomId: ${liveRoomId}`)
    } else {
      // Fall back to universal data
      const { roomId } = extractUserFromUniversalData(liveLiveHtml)
      liveRoomId = roomId
      console.log(`  -> Universal Data roomId: ${liveRoomId}`)
    }

    // Room info API (if live)
    if (liveRoomId) {
      const roomInfoRes = await http.get(
        `https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=${liveRoomId}&type=live`,
      )
      const roomInfoText = await roomInfoRes.text()
      writeFileSync(join(FIXTURE_DIR, `${liveUser}-room-info.json`), roomInfoText)
      console.log(`  -> Room info API: ${roomInfoText.length} bytes`)
    }

    // ── Offline user ──
    console.log(`\nFetching offline user: @${offlineUser}`)

    const offlineProfileRes = await http.get(`https://www.tiktok.com/@${offlineUser}`)
    const offlineProfileHtml = await offlineProfileRes.text()
    writeFileSync(join(FIXTURE_DIR, `${offlineUser}-profile.html`), offlineProfileHtml)
    console.log(`  -> Profile page: ${offlineProfileHtml.length} bytes`)

    const offlineLiveRes = await http.get(`https://www.tiktok.com/@${offlineUser}/live`)
    const offlineLiveHtml = await offlineLiveRes.text()
    writeFileSync(join(FIXTURE_DIR, `${offlineUser}-live.html`), offlineLiveHtml)
    console.log(`  -> Live page: ${offlineLiveHtml.length} bytes`)

    const { userId: offlineUserId, roomId: offlineRoomId } =
      extractUserFromUniversalData(offlineProfileHtml)
    console.log(`  -> Universal Data: userId=${offlineUserId}, roomId=${offlineRoomId}`)
  } catch (err) {
    console.error("Error capturing fixtures:", err)
  }

  await http.close()
  console.log(`\nFixtures saved to ${FIXTURE_DIR}/`)
}

capture()
