import { describe, expect, test } from "bun:test"
import { parseArgs } from "../src/lib/cli"

describe("parseArgs", () => {
  test("parses --user", () => {
    const cfg = parseArgs(["bun", "test", "--user", "testuser"])
    expect(cfg.user).toBe("testuser")
  })

  test("strips leading @ from user", () => {
    const cfg = parseArgs(["bun", "test", "--user", "@testuser"])
    expect(cfg.user).toBe("testuser")
  })

  test("parses --output", () => {
    const cfg = parseArgs(["bun", "test", "--user", "u", "--output", "/videos"])
    expect(cfg.outputDir).toBe("/videos")
  })

  test("parses --interval", () => {
    const cfg = parseArgs(["bun", "test", "--user", "u", "--interval", "10"])
    expect(cfg.interval).toBe(10)
  })

  test("parses --duration (minutes, converted to seconds)", () => {
    const cfg = parseArgs(["bun", "test", "--user", "u", "--duration", "5"])
    expect(cfg.duration).toBe(300)
  })

  test("parses --proxy", () => {
    const cfg = parseArgs(["bun", "test", "--user", "u", "--proxy", "http://proxy:8080"])
    expect(cfg.proxy).toBe("http://proxy:8080")
  })

  test("parses --log-level", () => {
    const cfg = parseArgs(["bun", "test", "--user", "u", "--log-level", "debug"])
    expect(cfg.logLevel).toBe("debug")
  })

  test("throws on missing --user", () => {
    expect(() => parseArgs(["bun", "test"])).toThrow()
  })

  test("throws on invalid --interval", () => {
    expect(() => parseArgs(["bun", "test", "--user", "u", "--interval", "0"])).toThrow()
    expect(() => parseArgs(["bun", "test", "--user", "u", "--interval", "-1"])).toThrow()
  })

  test("throws on invalid --duration", () => {
    expect(() => parseArgs(["bun", "test", "--user", "u", "--duration", "-1"])).toThrow()
  })

  test("throws on invalid --log-level", () => {
    expect(() => parseArgs(["bun", "test", "--user", "u", "--log-level", "verbose"])).toThrow()
  })

  test("parses -u as shorthand for --user", () => {
    const cfg = parseArgs(["bun", "test", "-u", "testuser"])
    expect(cfg.user).toBe("testuser")
  })

  test("parses -o as shorthand for --output", () => {
    const cfg = parseArgs(["bun", "test", "-u", "u", "-o", "/videos"])
    expect(cfg.outputDir).toBe("/videos")
  })

  test("parses -i as shorthand for --interval", () => {
    const cfg = parseArgs(["bun", "test", "-u", "u", "-i", "10"])
    expect(cfg.interval).toBe(10)
  })

  test("parses -d as shorthand for --duration", () => {
    const cfg = parseArgs(["bun", "test", "-u", "u", "-d", "5"])
    expect(cfg.duration).toBe(300)
  })

  test("parses -p as shorthand for --proxy", () => {
    const cfg = parseArgs(["bun", "test", "-u", "u", "-p", "http://proxy:8080"])
    expect(cfg.proxy).toBe("http://proxy:8080")
  })

  test("parses -l as shorthand for --log-level", () => {
    const cfg = parseArgs(["bun", "test", "-u", "u", "-l", "debug"])
    expect(cfg.logLevel).toBe("debug")
  })

  test("parses -c as shorthand for --cookies", () => {
    const cfg = parseArgs(["bun", "test", "-u", "u", "-c", "./custom-cookies.json"])
    expect(cfg.cookiesPath).toBe("./custom-cookies.json")
  })
})
