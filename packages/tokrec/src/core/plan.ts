/**
 * Tick policy — pure mapping from a `Verdict` plus facts to an action.
 *
 * No I/O, no clock, no promises. `session/` executes the returned plan.
 */

import type { RoomRef, StreamRef, Verdict } from "./verdict"

export interface TickFacts {
  readonly recording: boolean
  readonly recordedSec: number
  readonly oneShot: boolean
  readonly consecutiveErrors: number
}

export type TickPlan =
  | { kind: "poll"; note: string }
  | { kind: "hold"; reason: "restricted" | "no-stream-url"; room: RoomRef }
  | { kind: "record"; room: RoomRef; stream: StreamRef }
  | { kind: "stop"; why: "one-shot" | "gave-up" }

export function planTick(v: Verdict, f: TickFacts): TickPlan {
  // No user-stop arm: `stop()` aborts the scope, which ends the poll loop before
  // the next tick. A user stop is a signal, never a verdict.
  switch (v.reason) {
    case "live":
      if (f.recording) return { kind: "poll", note: "already recording" }
      if (!v.room || !v.stream) return { kind: "poll", note: "live without refs" }
      return { kind: "record", room: v.room, stream: v.stream }

    case "no-stream-url":
    case "restricted":
      if (!v.room) return { kind: "poll", note: "missing room" }
      return { kind: "hold", reason: v.reason, room: v.room }

    case "offline":
      return f.oneShot && f.recordedSec > 0
        ? { kind: "stop", why: "one-shot" }
        : { kind: "poll", note: "offline" }

    case "no-room-id":
      return f.consecutiveErrors >= 10
        ? { kind: "stop", why: "gave-up" }
        : { kind: "poll", note: "no room" }

    case "error":
      return { kind: "poll", note: v.failure?.message ?? "error" }
  }
}
