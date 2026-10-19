import type { LiveInfo } from "../../../domain/verdict"
import type { HttpClient } from "../../../ports/http"
import type { WebcastReader } from "../../../ports/tiktok"

export interface ResolveContext {
  user: string
  http: HttpClient
  debug: (msg: string) => void
  fetchPage: (user: string, path: string) => Promise<{ html: string; baseUrl: string } | null>
  webcast: WebcastReader
  flagError: () => void
}

export interface RoomSource {
  readonly name: string
  resolve(ctx: ResolveContext): Promise<LiveInfo | null>
}
