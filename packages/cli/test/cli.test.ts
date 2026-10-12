import { describe, expect, test } from "bun:test"
import type { RecorderConfig } from "@zfadhli/tokrec"
import { parseArgs } from "../src/cli"

/** Extract config from CLIResult for record commands. */
function cfg(args: string[]): RecorderConfig {
  const result = parseArgs(args)
  if (result.command !== "record") throw new Error(`Expected record, got ${result.command}`)
  return result.config
}

describe("parseArgs", () => {
  test("parses --user", () => {
    expect(cfg(["bun", "test", "--user", "testuser"]).user).toBe("testuser")
  })

  test("strips leading @ from user", () => {
    expect(cfg(["bun", "test", "--user", "@testuser"]).user).toBe("testuser")
  })

  test("parses --output", () => {
    expect(cfg(["bun", "test", "--user", "u", "--output", "/videos"]).outputDir).toBe("/videos")
  })

  test("parses --interval", () => {
    expect(cfg(["bun", "test", "--user", "u", "--interval", "10"]).interval).toBe(10)
  })

  test("parses --duration (minutes, converted to seconds)", () => {
    expect(cfg(["bun", "test", "--user", "u", "--duration", "5"]).duration).toBe(300)
  })

  test("parses --proxy", () => {
    expect(cfg(["bun", "test", "--user", "u", "--proxy", "http://proxy:8080"]).proxy).toBe(
      "http://proxy:8080",
    )
  })

  test("parses --log-level", () => {
    expect(cfg(["bun", "test", "--user", "u", "--log-level", "debug"]).logLevel).toBe("debug")
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
    expect(cfg(["bun", "test", "-u", "testuser"]).user).toBe("testuser")
  })

  test("parses -o as shorthand for --output", () => {
    expect(cfg(["bun", "test", "-u", "u", "-o", "/videos"]).outputDir).toBe("/videos")
  })

  test("parses -i as shorthand for --interval", () => {
    expect(cfg(["bun", "test", "-u", "u", "-i", "10"]).interval).toBe(10)
  })

  test("parses -d as shorthand for --duration", () => {
    expect(cfg(["bun", "test", "-u", "u", "-d", "5"]).duration).toBe(300)
  })

  test("parses -p as shorthand for --proxy", () => {
    expect(cfg(["bun", "test", "-u", "u", "-p", "http://proxy:8080"]).proxy).toBe(
      "http://proxy:8080",
    )
  })

  test("parses -l as shorthand for --log-level", () => {
    expect(cfg(["bun", "test", "-u", "u", "-l", "debug"]).logLevel).toBe("debug")
  })

  test("parses -c as shorthand for --cookies", () => {
    expect(cfg(["bun", "test", "-u", "u", "-c", "./custom-cookies.json"]).cookiesPath).toBe(
      "./custom-cookies.json",
    )
  })
})
