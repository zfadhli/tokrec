import type { RoomRef, SourceId, StreamRef } from "../../../domain/verdict"
import type { HttpClient } from "../../../ports/http"
import type { WebcastReader } from "../../../ports/tiktok"

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
