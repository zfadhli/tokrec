/**
 * Discovery chain — one idea in one file: a source reports facts, the chain
 * turns every outcome (including a throw) into evidence, and the first room or
 * gate refusal ends it.
 *
 * Types, candidate constructors, and the runner live together because they are
 * a single contract; splitting them across `types.ts` and `candidates.ts` only
 * added import edges.
 */

import type {
  Evidence,
  EvidenceOutcome,
  RoomRef,
  SourceId,
  StreamRef,
} from "../../../domain/verdict"
import type { HttpClient } from "../../http/wreq"
import type { WebcastReader } from "../webcast"

/**
 * What one discovery source found. `room`/`denied` end the chain; `miss` and
 * `failed` let the next source try — a throw is evidence, never a dead end.
 */
export type Candidate =
  | { kind: "room"; room: RoomRef; stream: StreamRef | null; source: SourceId }
  | { kind: "denied"; room: RoomRef; code: number; source: SourceId }
  | { kind: "miss"; note: string }
  | { kind: "failed"; error: Error }

export interface ResolveContext {
  user: string
  http: HttpClient
  debug: (msg: string) => void
  fetchPage: (user: string, path: string) => Promise<{ html: string; baseUrl: string } | null>
  webcast: WebcastReader
}

export interface DiscoverySource {
  readonly id: "page" | "api-live" | "profile"
  find(ctx: ResolveContext): Promise<Candidate>
}

// ─── candidate constructors ────────────────────────────────

/** Nothing found here — let the next source try. */
export function miss(note: string): Candidate {
  return { kind: "miss", note }
}

/** A transport/parse failure. The chain keeps going; it only wins over a miss. */
export function failed(error: unknown): Candidate {
  return { kind: "failed", error: error instanceof Error ? error : new Error(String(error)) }
}

/**
 * Room live with a stream URL. Uses `knownUrl` when the page already carried
 * it; otherwise asks the Webcast API. A 4003110 refusal becomes `denied`.
 */
export async function withStream(
  ctx: ResolveContext,
  room: RoomRef,
  source: SourceId,
  knownUrl: string | null,
): Promise<Candidate> {
  if (knownUrl) return { kind: "room", room, stream: { url: knownUrl }, source }
  const res = await ctx.webcast.fetchStreamUrlFromApi(room.id)
  if (res.ok) {
    return { kind: "room", room, stream: res.value ? { url: res.value } : null, source }
  }
  if (res.statusCode === 4003110) return refused(ctx, room.id, room.title, source)
  return { kind: "room", room, stream: null, source }
}

/** Authoritative room/info lookup: the single 4003110 consumer for room IDs. */
export async function fromRoomInfo(
  ctx: ResolveContext,
  roomId: string,
  source: SourceId,
): Promise<Candidate> {
  const res = await ctx.webcast.roomInfo(roomId)
  if (res.ok) {
    if (!res.value) return miss(`room/info returned no data for ${roomId}`)
    return { kind: "room", room: res.value.room, stream: res.value.stream, source }
  }
  if (res.statusCode === 4003110) return refused(ctx, roomId, null, source)
  if (res.statusCode === 0) return failed(new Error(`room/info transport failure for ${roomId}`))
  return miss(`room/info HTTP ${res.statusCode} for ${roomId}`)
}

/** Gate refusal: check_alive decides whether the room is live (restricted) or offline. */
export async function refused(
  ctx: ResolveContext,
  roomId: string,
  title: string | null,
  source: SourceId,
): Promise<Candidate> {
  const room = await ctx.webcast.refusedRoom(roomId, title)
  return { kind: "denied", room, code: 4003110, source }
}

// ─── runner ────────────────────────────────────────────────

function outcomeOf(candidate: Candidate): EvidenceOutcome {
  switch (candidate.kind) {
    case "room":
      return "hit"
    case "denied":
      return "denied"
    case "failed":
      return "error"
    case "miss":
      return "miss"
  }
}

/**
 * Run discovery sources in order. A throw — sync or async — becomes a
 * `failed` candidate and the chain continues: the `probe.ts:154` dead end,
 * inverted. A room or a gate refusal ends the chain; the first failure
 * outranks a later miss.
 */
export async function discover(
  sources: readonly DiscoverySource[],
  ctx: ResolveContext,
): Promise<{ candidate: Candidate; evidence: Evidence[] }> {
  const evidence: Evidence[] = []
  let best: Candidate = { kind: "miss", note: "no sources configured" }

  for (const source of sources) {
    const candidate = await (async (): Promise<Candidate> => {
      try {
        return await source.find(ctx)
      } catch (error) {
        ctx.debug(
          `discover: ${source.id} threw — ${error instanceof Error ? error.message : error}`,
        )
        return { kind: "failed", error: error instanceof Error ? error : new Error(String(error)) }
      }
    })()
    evidence.push({
      source:
        candidate.kind === "room" || candidate.kind === "denied" ? candidate.source : source.id,
      outcome: outcomeOf(candidate),
    })
    if (candidate.kind === "room" || candidate.kind === "denied") return { candidate, evidence }
    // First failure is the root cause; a later failure must not overwrite it.
    if (candidate.kind === "failed" && best.kind !== "failed") best = candidate
  }

  return { candidate: best, evidence }
}
