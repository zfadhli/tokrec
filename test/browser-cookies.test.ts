/**
 * Tests for Firefox cookie extraction.
 *
 * Since extractTikTokCookiesFromFirefox() reads from the real filesystem
 * (~/.mozilla/firefox/), we test the parsing and DB access functions
 * in isolation using temporary directories.
 */

import { Database } from "bun:sqlite"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFirefoxProfilesIni } from "../src/browser-cookies"

// ─── parseFirefoxProfilesIni ──────────────────────────────────────

describe("parseFirefoxProfilesIni", () => {
  test("parses a valid profiles.ini with a default profile", () => {
    const ini = `[General]
StartWithLastProfile=1

[Profile0]
Name=default
IsRelative=1
path=1pese0rl.default-release
Default=1

[Profile1]
Name=dev
IsRelative=1
path=dev-edition-default
Default=0
`
    const dir = "/home/user/.mozilla/firefox"
    const result = parseFirefoxProfilesIni(mkIniFile(ini), dir)
    expect(result).toBe(join(dir, "1pese0rl.default-release"))
  })

  test("returns null when no default profile is marked", () => {
    const ini = `[Profile0]
Name=test
IsRelative=1
Path=test-profile
Default=0
`
    const result = parseFirefoxProfilesIni(mkIniFile(ini), "/fake/dir")
    expect(result).toBeNull()
  })

  test("handles IsRelative=0 (absolute path)", () => {
    const ini = `[Profile0]
Name=default
IsRelative=0
Path=/custom/path/to/profile
Default=1
`
    const result = parseFirefoxProfilesIni(mkIniFile(ini), "/firefox")
    expect(result).toBe("/custom/path/to/profile")
  })

  test("handles empty/corrupt profiles.ini gracefully", () => {
    expect(parseFirefoxProfilesIni(mkIniFile(""), "/fake/dir")).toBeNull()
    expect(parseFirefoxProfilesIni(mkIniFile("not ini format"), "/fake/dir")).toBeNull()
  })
})

// ─── Cookie DB query logic ──────────────────────────────────────────

describe("cookie SQLite query", () => {
  let tmpDir: string
  let dbPath: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tokrec-cookies-test-"))
    dbPath = join(tmpDir, "cookies.sqlite")

    const db = new Database(dbPath, { create: true })
    db.run(`
      CREATE TABLE moz_cookies (
        id INTEGER PRIMARY KEY,
        name TEXT,
        value TEXT,
        host TEXT,
        path TEXT
      )
    `)
    db.run(`
      INSERT INTO moz_cookies (name, value, host, path) VALUES
        ('sessionid_ss', 'test_session_id_12345', '.tiktok.com', '/'),
        ('tt-target-idc', 'test_idc_value', '.tiktok.com', '/'),
        ('other_cookie', 'should_be_ignored', '.example.com', '/')
    `)
    db.close()
  })

  afterAll(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  })

  test("reads sessionid_ss from cookies.sqlite", () => {
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
      expect(session?.value).toBe("test_session_id_12345")

      const idc = rows.find((r) => r.name === "tt-target-idc")
      expect(idc?.value).toBe("test_idc_value")
    } finally {
      db.close()
    }
  })

  test("returns empty rows when no TikTok cookies exist", () => {
    const emptyDb = join(tmpDir, "empty-cookies.sqlite")
    const db = new Database(emptyDb, { create: true })
    db.run(
      "CREATE TABLE moz_cookies (id INTEGER PRIMARY KEY, name TEXT, value TEXT, host TEXT, path TEXT)",
    )
    db.run(
      `INSERT INTO moz_cookies (name, value, host, path) VALUES ('some_cookie', 'val', '.other.com', '/')`,
    )
    db.close()

    const readDb = new Database(emptyDb, { readonly: true })
    try {
      const rows = readDb
        .query(
          `SELECT name, value FROM moz_cookies
           WHERE host LIKE '%.tiktok.com'
           AND name IN ('sessionid_ss', 'tt-target-idc')`,
        )
        .all() as Array<{ name: string; value: string }>

      expect(rows).toHaveLength(0)
    } finally {
      readDb.close()
    }
  })
})

// ─── Helper ─────────────────────────────────────────────────────────

function mkIniFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tokrec-ini-test-"))
  const path = join(dir, "profiles.ini")
  writeFileSync(path, content)
  return path
}
