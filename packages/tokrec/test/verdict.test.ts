/**
 * `verdictOf` is total: every reason is reachable from one branch.
 * The table is the contract — `isLive` and the old reason cascades are gone.
 */

import { describe, expect, test } from "bun:test"
import { isLiveReason, verdictOf } from "../src/domain/verdict"

const LIVE_ROOM = { id: "1", title: "t", live: true }
const OFFLINE_ROOM = { id: "1", title: "t", live: false }
const STREAM = { url: "https://example.test/s.flv" }
const FAILURE = new Error("boom")

describe("verdictOf", () => {
  const table: Array<{
    name: string
    input: Parameters<typeof verdictOf>[0]
    reason: string
    isLive: boolean
  }> = [
    {
      name: "failure wins",
      input: { failure: FAILURE, room: LIVE_ROOM },
      reason: "error",
      isLive: false,
    },
    { name: "no room", input: {}, reason: "no-room-id", isLive: false },
    { name: "offline room", input: { room: OFFLINE_ROOM }, reason: "offline", isLive: false },
    {
      name: "denied gate",
      input: { room: LIVE_ROOM, denied: true },
      reason: "restricted",
      isLive: true,
    },
    {
      name: "live room + stream",
      input: { room: LIVE_ROOM, stream: STREAM },
      reason: "live",
      isLive: true,
    },
    {
      name: "live room, no stream",
      input: { room: LIVE_ROOM },
      reason: "no-stream-url",
      isLive: true,
    },
  ]

  for (const row of table) {
    test(`${row.name} → ${row.reason}`, () => {
      const verdict = verdictOf(row.input)
      expect(verdict.reason).toBe(row.reason as never)
      expect(isLiveReason(verdict.reason)).toBe(row.isLive)
    })
  }

  test("denied loses to offline: room.live is checked first", () => {
    expect(verdictOf({ room: OFFLINE_ROOM, denied: true }).reason).toBe("offline")
  })

  test("carries room, stream, evidence, and failure through", () => {
    const evidence = [{ source: "page" as const, outcome: "hit" as const }]
    const verdict = verdictOf({ room: LIVE_ROOM, stream: STREAM, evidence, failure: FAILURE })
    expect(verdict.room).toBe(LIVE_ROOM)
    expect(verdict.stream).toBe(STREAM)
    expect(verdict.evidence).toBe(evidence)
    expect(verdict.failure).toBe(FAILURE)
  })
})
