/**
 * Verdict — the per-tick liveness result and its machine-readable reason.
 *
 * Pure domain type: no I/O, no imports outside `domain/`.
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

export interface LiveInfo {
  roomId: string | null
  isLive: boolean
  streamUrl: string | null
  title: string | null
  reason: LiveReason
  source: string
}
