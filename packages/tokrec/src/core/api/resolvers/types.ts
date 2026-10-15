import type { LiveReason } from "../../../lib/config"
import type { HttpClient } from "../client"
import type { createWebcastApi } from "../webcast"

export interface LiveInfo {
  roomId: string | null
  isLive: boolean
  streamUrl: string | null
  title: string | null
  reason: LiveReason
  source: string
}

export interface ResolveContext {
  user: string
  http: HttpClient
  debug: (msg: string) => void
  fetchPage: (user: string, path: string) => Promise<{ html: string; baseUrl: string } | null>
  webcast: ReturnType<typeof createWebcastApi>
  flagError: () => void
}

export interface RoomSource {
  readonly name: string
  resolve(ctx: ResolveContext): Promise<LiveInfo | null>
}
