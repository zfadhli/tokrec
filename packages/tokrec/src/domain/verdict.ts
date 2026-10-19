/**
 * Verdict — the per-tick liveness result and its machine-readable reason.
 *
 * Pure domain type: no I/O, no imports outside `domain/`. `reason` is derived
 * by `verdictOf`, never passed by callers; discovery reports facts, one total
 * function decides what they mean.
 */

/**
 * Machine-readable reason for a LIVE status verdict.
 * "live" = stream URL resolved; "offline" = room not live;
 * "restricted" = live but age-protected/gated (stream refused);
 * "no-stream-url" = live but no URL and no gate evidence;
 * "no-room-id" = no discovery path produced a room ID;
 * "error" = network/parse failure across paths.
 */
export type LiveReason =
  | "live"
  | "offline"
  | "restricted"
  | "no-stream-url"
  | "no-room-id"
  | "error"

export interface RoomRef {
  readonly id: string
  readonly title: string | null
  readonly live: boolean
}

export interface StreamRef {
  readonly url: string
}

/** Where a fact came from. Legacy `LiveInfo.source` values stay valid. */
export type SourceId = "page" | "sigi" | "room-info" | "api-live" | "profile" | "none"

export type EvidenceOutcome = "hit" | "miss" | "denied" | "error"

export interface Evidence {
  readonly source: SourceId
  readonly outcome: EvidenceOutcome
}

export interface Verdict {
  readonly reason: LiveReason
  readonly room: RoomRef | null
  readonly stream: StreamRef | null
  readonly evidence: readonly Evidence[]
  readonly failure: Error | null
}

/** Whether a reason means the room itself is live (holding or recording). */
export function isLiveReason(reason: LiveReason): boolean {
  return reason === "live" || reason === "restricted" || reason === "no-stream-url"
}

/**
 * The single constructor for `Verdict`. Six branches cover every reason;
 * precedence is failure → no room → offline → denied → live → no URL.
 */
export function verdictOf(x: {
  room?: RoomRef | null
  stream?: StreamRef | null
  denied?: boolean
  failure?: Error | null
  evidence?: readonly Evidence[]
}): Verdict {
  const room = x.room ?? null
  const stream = x.stream ?? null
  const base = { room, stream, evidence: x.evidence ?? [], failure: x.failure ?? null }

  if (x.failure) return { ...base, reason: "error" }
  if (!room) return { ...base, reason: "no-room-id" }
  if (!room.live) return { ...base, reason: "offline" }
  if (x.denied) return { ...base, reason: "restricted" }
  if (stream) return { ...base, reason: "live" }
  return { ...base, reason: "no-stream-url" }
}
