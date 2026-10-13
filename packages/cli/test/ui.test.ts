import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createDisplay } from "../src/ui"

const writes: string[] = []
let writeSpy: ReturnType<typeof spyOn> | null = null

function spyStdout(): void {
  writeSpy = spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    writes.push(String(chunk))
    return true
  }) as typeof process.stdout.write)
}

afterEach(() => {
  writes.length = 0
  writeSpy?.mockRestore()
  writeSpy = null
})

describe("restricted / no-stream display", () => {
  test("userRestricted mentions age-protected", () => {
    spyStdout()
    createDisplay().userRestricted("x")
    expect(writes.join("")).toContain("age-protected")
  })

  test("userLiveNoStream mentions no stream URL", () => {
    spyStdout()
    createDisplay().userLiveNoStream("x", "123")
    expect(writes.join("")).toContain("no stream URL")
  })
})
