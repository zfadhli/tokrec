/**
 * The single error type the library throws, plus its code union.
 *
 * Pure band: `io/` constructs it (`ffmpeg-error`, `aborted`) and `app/`
 * constructs it (`config-error`), so it belongs below both.
 */

export type TikTokErrorCode =
  | "config-error"
  | "ffmpeg-not-found"
  | "ffmpeg-error"
  | "aborted"
  | "unknown"

export class TikTokError extends Error {
  constructor(
    public readonly code: TikTokErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message)
    this.name = "TikTokError"
  }
}
