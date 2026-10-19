import { afterEach, describe, expect, spyOn, test } from "bun:test"
import type { RecorderController } from "@zfadhli/tokrec"
import { attachDisplay, createDisplay } from "../src/ui"

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

describe("spinner in non-interactive mode", () => {
  test("emits plain lines, no cursor-hide or carriage-return rewrites", () => {
    spyStdout()
    const display = createDisplay()
    display.checkingUser("x")
    display.userLive("x", "123")
    const out = writes.join("")
    expect(out).toContain("Checking @x")
    expect(out).not.toContain("\u001B[?25l")
    expect(out).not.toContain("\r")
  })
})

/** Minimal `on`-only recorder stand-in; `attachDisplay` subscribes, never calls. */
function stubRecorder(): {
  recorder: Pick<RecorderController, "on">
  emit: (event: string, payload: unknown) => void
} {
  const handlers = new Map<string, (payload: unknown) => void>()
  const recorder = {
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler)
    },
  }
  return {
    recorder: recorder as unknown as Pick<RecorderController, "on">,
    emit: (event, payload) => handlers.get(event)?.(payload),
  }
}

describe("attachDisplay", () => {
  test("a live verdict prints [LIVE] with the room id", () => {
    spyStdout()
    const { recorder, emit } = stubRecorder()
    attachDisplay(createDisplay(), recorder, "someone")
    emit("verdict", {
      reason: "live",
      room: { id: "42", title: null, live: true },
      stream: { url: "https://cdn/x.flv" },
      evidence: [],
      failure: null,
    })
    const out = writes.join("")
    expect(out).toContain("[LIVE]")
    expect(out).toContain("42")
  })

  test("a finished download prints [DONE] with filename and size", () => {
    spyStdout()
    const { recorder, emit } = stubRecorder()
    attachDisplay(createDisplay(), recorder, "someone")
    emit("record", {
      phase: "download",
      file: "/out/someone=20260101_000000.ts",
      duration: 12,
      size: 2048,
    })
    const out = writes.join("")
    expect(out).toContain("someone=20260101_000000.ts")
    expect(out).toContain("KB")
  })
})
