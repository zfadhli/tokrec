import { describe, expect, test } from "bun:test"
import { bytesToHuman, formatFilename, sanitizeUser } from "../src/utils"

describe("formatFilename", () => {
  test("produces correct format", () => {
    const name = formatFilename("testuser")
    expect(name).toMatch(/^testuser=\d{8}_\d{6}\.flv$/)
  })

  test("accepts custom extension", () => {
    const name = formatFilename("u", "mp4")
    expect(name).toMatch(/\.mp4$/)
  })

  test("includes _part1 when part is provided", () => {
    const name = formatFilename("testuser", "flv", 1)
    expect(name).toMatch(/^testuser=\d{8}_\d{6}_part1\.flv$/)
  })

  test("increments part suffix", () => {
    const name2 = formatFilename("u", "flv", 2)
    expect(name2).toMatch(/_part2\.flv$/)
  })
})

describe("sanitizeUser", () => {
  test("strips leading @", () => {
    expect(sanitizeUser("@user")).toBe("user")
    expect(sanitizeUser("@@user")).toBe("user")
  })

  test("trims whitespace", () => {
    expect(sanitizeUser("  user  ")).toBe("user")
  })

  test("leaves clean usernames alone", () => {
    expect(sanitizeUser("user")).toBe("user")
    expect(sanitizeUser("officialgeilegisela")).toBe("officialgeilegisela")
  })
})

describe("bytesToHuman", () => {
  test("formats bytes correctly", () => {
    expect(bytesToHuman(0)).toBe("0 B")
    expect(bytesToHuman(500)).toBe("500.0 B")
    expect(bytesToHuman(1024)).toBe("1.0 KB")
    expect(bytesToHuman(1048576)).toBe("1.0 MB")
    expect(bytesToHuman(1073741824)).toBe("1.0 GB")
  })
})
