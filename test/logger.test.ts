import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { createLogger } from "../src/lib/logger"

describe("createLogger", () => {
  const testLog = "/tmp/test-tiktok-recorder.log"

  test("writes to file", () => {
    // Clean up
    try {
      unlinkSync(testLog)
    } catch {}

    const log = createLogger({ level: "info", logFile: testLog })
    log.info("hello world")

    expect(existsSync(testLog)).toBe(true)
    const content = readFileSync(testLog, "utf-8")
    expect(content).toContain("hello world")
    expect(content).toContain("[INFO]")

    try {
      unlinkSync(testLog)
    } catch {}
  })

  test("console: false still writes to file", () => {
    try {
      unlinkSync(testLog)
    } catch {}

    const log = createLogger({ level: "info", logFile: testLog, console: false })
    log.info("file only message")

    expect(existsSync(testLog)).toBe(true)
    const content = readFileSync(testLog, "utf-8")
    expect(content).toContain("file only message")
    expect(content).toContain("[INFO]")

    try {
      unlinkSync(testLog)
    } catch {}
  })

  test("respects log level filtering", () => {
    try {
      unlinkSync(testLog)
    } catch {}

    const log = createLogger({ level: "warn", logFile: testLog })
    log.debug("should not appear")
    log.info("should not appear")
    log.warn("warning message")
    log.error("error message")

    const content = readFileSync(testLog, "utf-8")
    expect(content).not.toContain("should not appear")
    expect(content).toContain("warning message")
    expect(content).toContain("error message")

    try {
      unlinkSync(testLog)
    } catch {}
  })
})
