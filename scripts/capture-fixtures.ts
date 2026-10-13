/**
 * Capture TikTok HTML/API responses as test fixtures.
 * Uses the same HTTP client (wreq-js with TLS fingerprinting + cookies)
 * as the main recorder to ensure authentic responses.
 *
 * Usage: bun run scripts/capture-fixtures.ts [--user <name> ...] [--help]
 *
 * Output: packages/tokrec/test/fixtures/tiktok/
 *   - <user>-profile.html    — /@<user> profile page (__UNIVERSAL_DATA_FOR_REHYDRATION__)
 *   - <user>-live.html       — /@<user>/live page
 *   - <user>-api-live.json   — /api-live/user/room/?aid=1988&uniqueId=<user>&sourceType=54
 *   - <user>-room-info.json  — /webcast/room/info/?room_id=<roomId>&type=live (when a roomId is found)
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const FIXTURE_DIR = join(ROOT, "packages/tokrec/test/fixtures/tiktok")

const DEFAULT_USERS = ["anomaliaa27", "naylaarindinta"]

const USAGE = `Usage: bun run scripts/capture-fixtures.ts [options]

Capture TikTok HTML/API responses as test fixtures.

Options:
  --user <name>  TikTok username to capture (repeatable).
                 Default when omitted: anomaliaa27 naylaarindinta.
  --help, -h     Print this usage and exit.

For each user writes <user>-profile.html, <user>-live.html,
<user>-api-live.json, and <user>-room-info.json (when a roomId is found).`

interface Cookies {
  sessionid_ss: string
  "tt-target-idc"?: string
}

async function loadCookies(): Promise<Cookies | null> {
  // Try Firefox first
  try {
    const { extractTikTokCookiesFromFirefox } = await import(
      join(ROOT, "packages/cli/src/browser-cookies.ts")
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

export function parseCaptureArgs(argv: string[]): { users: string[]; help: boolean } {
  const users: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      return { users, help: true }
    }
    if (arg === "--user") {
      const name = argv[++i]
      if (!name || name.startsWith("-")) {
        console.error(`Missing value for --user\n${USAGE}`)
        process.exit(1)
      }
      users.push(name)
      continue
    }
    if (arg.startsWith("--user=")) {
      const name = arg.slice("--user=".length)
      if (!name) {
        console.error(`Missing value for --user\n${USAGE}`)
        process.exit(1)
      }
      users.push(name)
      continue
    }
    console.error(`Unknown argument: ${arg}\n${USAGE}`)
    process.exit(1)
  }
  return { users: users.length > 0 ? users : [...DEFAULT_USERS], help: false }
}

async function capture() {
  const { users, help } = parseCaptureArgs(process.argv.slice(2))
  if (help) {
    console.log(USAGE)
    process.exit(0)
  }

  const cookies = await loadCookies()
  if (!cookies) {
    console.error("No cookies found — cannot capture fixtures")
    process.exit(1)
  }

  const { createHttpClient } = await import(join(ROOT, "packages/tokrec/src/core/api/client.ts"))
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

  const { extractUserFromUniversalData, extractSigiState } = await import(
    join(ROOT, "packages/tokrec/src/core/api/tiktok.ts")
  )

  try {
    for (const user of users) {
      console.log(`\nFetching user: @${user}`)

      // Profile page
      const profileRes = await http.get(`https://www.tiktok.com/@${user}`)
      const profileHtml = await profileRes.text()
      writeFileSync(join(FIXTURE_DIR, `${user}-profile.html`), profileHtml)
      console.log(`  -> Profile page: ${profileHtml.length} bytes`)

      // Live page
      const liveRes = await http.get(`https://www.tiktok.com/@${user}/live`)
      const liveHtml = await liveRes.text()
      writeFileSync(join(FIXTURE_DIR, `${user}-live.html`), liveHtml)
      console.log(`  -> Live page: ${liveHtml.length} bytes`)

      // api-live endpoint (room + status regardless of page size)
      const apiLiveRes = await http.get(
        `https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=${encodeURIComponent(user)}&sourceType=54`,
      )
      const apiLiveText = await apiLiveRes.text()
      writeFileSync(join(FIXTURE_DIR, `${user}-api-live.json`), apiLiveText)
      console.log(`  -> api-live: ${apiLiveText.length} bytes`)

      // Check for room ID from SIGI_STATE (live page) or universal data
      const sigi = extractSigiState(liveHtml)
      let roomId: string | null = null
      if (sigi?.LiveRoom?.liveRoomUserInfo?.user?.roomId) {
        roomId = String(sigi.LiveRoom.liveRoomUserInfo.user.roomId)
        console.log(`  -> SIGI_STATE roomId: ${roomId}`)
      } else {
        const fromLive = extractUserFromUniversalData(liveHtml)
        roomId = fromLive.roomId
        if (roomId) {
          console.log(`  -> Universal Data roomId: ${roomId}`)
        } else {
          const { userId, roomId: profileRoomId } = extractUserFromUniversalData(profileHtml)
          roomId = profileRoomId
          console.log(`  -> Universal Data: userId=${userId}, roomId=${roomId}`)
        }
      }

      // Room info API (if a roomId was found)
      if (roomId) {
        const roomInfoRes = await http.get(
          `https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=${roomId}&type=live`,
        )
        const roomInfoText = await roomInfoRes.text()
        writeFileSync(join(FIXTURE_DIR, `${user}-room-info.json`), roomInfoText)
        console.log(`  -> Room info API: ${roomInfoText.length} bytes`)
      }
    }
  } catch (err) {
    console.error("Error capturing fixtures:", err)
  }

  await http.close()
  console.log(`\nFixtures saved to ${FIXTURE_DIR}/`)
}

capture()
