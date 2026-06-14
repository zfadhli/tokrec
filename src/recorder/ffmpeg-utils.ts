/**
 * Shared FFmpeg utilities — binary resolution, duration formatting, constants.
 */

import { statSync } from "node:fs"

/** Kill FFmpeg if no output is received within this window after spawn. */
export const FFMPEG_STARTUP_TIMEOUT = 30_000

/** Find FFmpeg binary via Bun.which() or PATH search. */
export function findFfmpegPath(): string | null {
  const bunWhich = (Bun as any)?.which
  if (typeof bunWhich === "function") {
    return (bunWhich("ffmpeg") as string) ?? null
  }
  const paths = process.env.PATH?.split(":") ?? []
  for (const dir of paths) {
    try {
      const full = `${dir}/ffmpeg`
      statSync(full)
      return full
    } catch {
      // not found in this directory
    }
  }
  return null
}

/** Format seconds into a compact human-readable duration. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}m ${s}s`
}
