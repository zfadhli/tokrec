import { describe, expect, test } from "bun:test"
import type { LiveReason, RoomRef, Verdict } from "../src/domain/verdict"
import { verdictOf } from "../src/domain/verdict"
import { planTick, type TickFacts, type TickPlan } from "../src/policy/tick"

const ROOM: RoomRef = { id: "123", title: "t", live: true }
const STREAM = { url: "https://example.test/s.flv" }

function verdict(reason: LiveReason): Verdict {
  switch (reason) {
    case "live":
      return verdictOf({ room: ROOM, stream: STREAM })
    case "restricted":
      return verdictOf({ room: ROOM, denied: true })
    case "no-stream-url":
      return verdictOf({ room: ROOM })
    case "offline":
      return verdictOf({ room: { ...ROOM, live: false } })
    case "no-room-id":
      return verdictOf({})
    case "error":
      return verdictOf({ failure: new Error("boom") })
  }
}

const IDLE: TickFacts = {
  recording: false,
  recordedSec: 0,
  oneShot: false,
  consecutiveErrors: 0,
  stopRequested: false,
}

const FACTS: [string, TickFacts][] = [
  ["idle", IDLE],
  ["recording", { ...IDLE, recording: true, recordedSec: 120 }],
  ["oneShot", { ...IDLE, recordedSec: 120, oneShot: true }],
  ["gaveUp", { ...IDLE, consecutiveErrors: 10 }],
]

const REASONS: LiveReason[] = [
  "live",
  "restricted",
  "no-stream-url",
  "offline",
  "no-room-id",
  "error",
]

const EXPECTED: Record<LiveReason, Record<string, TickPlan>> = {
  live: {
    idle: { kind: "record", room: ROOM, stream: STREAM },
    recording: { kind: "poll", note: "already recording" },
    oneShot: { kind: "record", room: ROOM, stream: STREAM },
    gaveUp: { kind: "record", room: ROOM, stream: STREAM },
  },
  restricted: {
    idle: { kind: "hold", reason: "restricted", room: ROOM },
    recording: { kind: "hold", reason: "restricted", room: ROOM },
    oneShot: { kind: "hold", reason: "restricted", room: ROOM },
    gaveUp: { kind: "hold", reason: "restricted", room: ROOM },
  },
  "no-stream-url": {
    idle: { kind: "hold", reason: "no-stream-url", room: ROOM },
    recording: { kind: "hold", reason: "no-stream-url", room: ROOM },
    oneShot: { kind: "hold", reason: "no-stream-url", room: ROOM },
    gaveUp: { kind: "hold", reason: "no-stream-url", room: ROOM },
  },
  offline: {
    idle: { kind: "poll", note: "offline" },
    recording: { kind: "poll", note: "offline" },
    oneShot: { kind: "stop", why: "one-shot" },
    gaveUp: { kind: "poll", note: "offline" },
  },
  "no-room-id": {
    idle: { kind: "poll", note: "no room" },
    recording: { kind: "poll", note: "no room" },
    oneShot: { kind: "poll", note: "no room" },
    gaveUp: { kind: "stop", why: "gave-up" },
  },
  error: {
    idle: { kind: "poll", note: "boom" },
    recording: { kind: "poll", note: "boom" },
    oneShot: { kind: "poll", note: "boom" },
    gaveUp: { kind: "poll", note: "boom" },
  },
}

describe("planTick — 6 reasons × 4 fact combinations", () => {
  for (const reason of REASONS) {
    for (const [factsName, facts] of FACTS) {
      test(`${reason} × ${factsName}`, () => {
        const expected = EXPECTED[reason][factsName]
        if (!expected) throw new Error(`missing expectation for ${reason} × ${factsName}`)
        expect(planTick(verdict(reason), facts)).toEqual(expected)
      })
    }
  }

  test("stopRequested outranks every reason", () => {
    for (const reason of REASONS) {
      expect(planTick(verdict(reason), { ...IDLE, stopRequested: true })).toEqual({
        kind: "stop",
        why: "user",
      })
    }
  })

  test("a single error below the threshold keeps polling", () => {
    expect(planTick(verdict("no-room-id"), { ...IDLE, consecutiveErrors: 9 })).toEqual({
      kind: "poll",
      note: "no room",
    })
  })

  test("one-shot stops only after something was recorded", () => {
    expect(planTick(verdict("offline"), { ...IDLE, oneShot: true, recordedSec: 0 })).toEqual({
      kind: "poll",
      note: "offline",
    })
  })
})
