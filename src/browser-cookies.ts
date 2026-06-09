/**
 * Browser cookie extraction — reads TikTok session cookies from Firefox's
 * cookie store using bun:sqlite (no external dependencies).
 *
 * Falls back to cookies.json if Firefox isn't available or if no TikTok
 * login session is found.
 */

import { Database } from "bun:sqlite"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface TikTokCookies {
  sessionid_ss: string
  "tt-target-idc"?: string
}

/**
 * Extract TikTok session cookies from Firefox's cookie store.
 *
 * Searches all profile directories under ~/.mozilla/firefox/ for a
 * cookies.sqlite file, then queries it for TikTok session cookies.
 *
 * Returns null if Firefox isn't found, cookies can't be read, or no
 * TikTok login session exists.
 */
export function extractTikTokCookiesFromFirefox(): TikTokCookies | null {
  const dbPath = findFirefoxCookieDb()
  if (!dbPath) return null

  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      const rows = db
        .query(
          `SELECT name, value FROM moz_cookies
           WHERE host LIKE '%.tiktok.com'
           AND name IN ('sessionid_ss', 'tt-target-idc')`,
        )
        .all() as Array<{ name: string; value: string }>

      const session = rows.find((r) => r.name === "sessionid_ss")
      if (!session?.value) return null

      const result: TikTokCookies = { sessionid_ss: session.value }
      const idc = rows.find((r) => r.name === "tt-target-idc")
      if (idc?.value) result["tt-target-idc"] = idc.value

      return result
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/**
 * Locate the Firefox cookies.sqlite by scanning profile directories.
 *
 * Strategy:
 *   1. Check ~/.mozilla/firefox/ for profiles.ini and parse the default profile.
 *   2. Fall back to scanning directory entries that look like Firefox profiles
 *      (contain a cookies.sqlite file).
 */
/** @public Exported for testing */
export function findFirefoxCookieDb(): string | null {
  const firefoxDir = join(homedir(), ".mozilla", "firefox")
  if (!existsSync(firefoxDir)) return null

  // Try profiles.ini first for a reliable default-profile path
  const iniPath = join(firefoxDir, "profiles.ini")
  if (existsSync(iniPath)) {
    try {
      const profilePath = parseFirefoxProfilesIni(iniPath, firefoxDir)
      if (profilePath) {
        const dbPath = join(profilePath, "cookies.sqlite")
        if (existsSync(dbPath)) return dbPath
      }
    } catch {
      // fall through to directory scan
    }
  }

  // Fallback: scan for any directory containing cookies.sqlite
  const entries = readdirSync(firefoxDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const dbPath = join(firefoxDir, entry.name, "cookies.sqlite")
    if (existsSync(dbPath)) return dbPath
  }

  return null
}

/**
 * Parse Firefox's profiles.ini to find the default profile path.
 *
 * The INI format looks like:
 *   [Profile0]
 *   Name=default
 *   IsRelative=1
 *   Path=1pese0rl.default-release
 *   Default=1
 */
/** @public Exported for testing */
export function parseFirefoxProfilesIni(iniPath: string, firefoxDir: string): string | null {
  const text = readFileSync(iniPath, "utf-8")

  let defaultPath: string | null = null
  let isRelative = true
  let inProfile = false

  for (const line of text.split("\n")) {
    const trimmed = line.trim()

    // Section header
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (inProfile && defaultPath) break // found it
      inProfile = trimmed.toLowerCase().startsWith("[profile")
      if (inProfile) {
        defaultPath = null
        isRelative = true
      }
      continue
    }

    if (!inProfile) continue

    const lower = trimmed.toLowerCase()
    if (lower.startsWith("path=")) {
      defaultPath = trimmed.slice(5)
    } else if (lower.startsWith("isrelative=")) {
      isRelative = trimmed.slice(11).trim() !== "0"
    } else if (lower.startsWith("default=")) {
      if (trimmed.slice(8).trim() !== "1") {
        // Not the default profile — skip
        inProfile = false
        defaultPath = null
      }
    }
  }

  if (!defaultPath) return null
  return isRelative ? join(firefoxDir, defaultPath) : defaultPath
}
