import { describe, expect, test } from "bun:test"
import { normalizeConfig, TikTokError, validateConfig } from "../src/lib/config"

describe("normalizeConfig", () => {
  test("fills in defaults for missing fields", () => {
    const cfg = normalizeConfig({ user: "testuser" })
    expect(cfg.user).toBe("testuser")
    expect(cfg.outputDir).toBe("./recordings")
    expect(cfg.interval).toBe(3)
    expect(cfg.duration).toBe(0)
    expect(cfg.logLevel).toBe("info")
  })

  test("preserves explicit values", () => {
    const cfg = normalizeConfig({
      user: "testuser",
      outputDir: "/custom/path",
      interval: 10,
      duration: 300,
      logLevel: "debug",
    })
    expect(cfg.outputDir).toBe("/custom/path")
    expect(cfg.interval).toBe(10)
    expect(cfg.duration).toBe(300)
    expect(cfg.logLevel).toBe("debug")
  })

  test("normalizeCodec and normalizeBitrate are undefined when not set", () => {
    const cfg = normalizeConfig({ user: "testuser" })
    expect(cfg.normalizeCodec).toBeUndefined()
    expect(cfg.normalizeBitrate).toBeUndefined()
  })

  test("normalizeCodec and normalizeBitrate pass through when set", () => {
    const cfg = normalizeConfig({
      user: "testuser",
      normalizeCodec: "aac",
      normalizeBitrate: "192k",
    })
    expect(cfg.normalizeCodec).toBe("aac")
    expect(cfg.normalizeBitrate).toBe("192k")
  })

  test("normalizeAudio defaults to true", () => {
    const cfg = normalizeConfig({ user: "testuser" })
    expect(cfg.normalizeAudio).toBe(true)
  })

  test("normalizeAudio can be explicitly set to false", () => {
    const cfg = normalizeConfig({ user: "testuser", normalizeAudio: false })
    expect(cfg.normalizeAudio).toBe(false)
  })

  test("normalizeAudio can be explicitly set to true", () => {
    const cfg = normalizeConfig({ user: "testuser", normalizeAudio: true })
    expect(cfg.normalizeAudio).toBe(true)
  })

  test("preserves cookies and proxy", () => {
    const cfg = normalizeConfig({
      user: "testuser",
      proxy: "http://127.0.0.1:8080",
      cookies: { sessionid_ss: "abc123" },
    })
    expect(cfg.proxy).toBe("http://127.0.0.1:8080")
    expect(cfg.cookies?.sessionid_ss).toBe("abc123")
  })
})

describe("validateConfig", () => {
  test("throws on empty user", () => {
    expect(() => validateConfig({ user: "" })).toThrow(TikTokError)
    expect(() => validateConfig({ user: "  " })).toThrow(TikTokError)
  })

  test("throws on interval < 1", () => {
    expect(() => validateConfig({ user: "u", interval: 0 })).toThrow(TikTokError)
  })

  test("throws on duration < 0", () => {
    expect(() => validateConfig({ user: "u", duration: -1 })).toThrow(TikTokError)
  })

  test("passes on valid config", () => {
    expect(() => validateConfig({ user: "testuser" })).not.toThrow()
    expect(() => validateConfig({ user: "testuser", interval: 1, duration: 0 })).not.toThrow()
  })
})
