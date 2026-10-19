/**
 * Live stream downloader — downloads a live stream via FFmpeg stdout pipe.
 *
 * Outputs MPEG-TS (.ts) format, which is crash-safe and append-friendly.
 * FFmpeg handles HTTP reconnection via -reconnect flags. When TikTok's
 * short-lived stream URL expires, FFmpeg exits and the outer loop fetches
 * a fresh URL via getNextUrl.
 *
 * Both FLV and HLS streams are handled by the same download function —
 * the only difference is an optional label in the log messages.
 */

import { createWriteStream, mkdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { DownloadProgress, RecordedFile } from "../../app/config"
import { TikTokError } from "../../core/errors"
import { bytesToHuman, formatDuration, formatFilename } from "../../core/format"
import type { Logger } from "../../core/log"
import { findFfmpegPath, pipeFfmpegSegment } from "./ffmpeg"

export async function downloadStream(
  liveUrl: string,
  user: string,
  outputDir: string,
  maxDuration: number,
  onProgress: ((info: DownloadProgress) => void) | undefined,
  getNextUrl: (() => Promise<string | null>) | undefined,
  signal: AbortSignal,
  logger?: Logger,
  cookies?: Record<string, string>,
): Promise<RecordedFile> {
  mkdirSync(outputDir, { recursive: true })
  const filename = formatFilename(user, "ts")
  const filepath = join(outputDir, filename)
  // FLV is the default container — an .m3u8 URL means the CDN served HLS.
  const prefix = liveUrl.includes(".m3u8") ? " (HLS)" : ""
  logger?.info(`Recording${prefix}: ${filename}`)

  const startTime = Date.now()

  /** File size read directly from disk — authoritative, avoids in-memory counter drift. */
  let fileSize = 0
  let lastProgressTime = 0

  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    throw new TikTokError(
      "ffmpeg-not-found",
      "FFmpeg not found — required for stream download. Install it:\n" +
        "  Linux:  apt install ffmpeg\n  macOS:  brew install ffmpeg",
    )
  }

  function elapsed(): number {
    return (Date.now() - startTime) / 1000
  }

  const writer = createWriteStream(filepath)

  try {
    while (!signal.aborted) {
      const remaining = maxDuration > 0 ? Math.max(1, maxDuration - elapsed()) : undefined
      await pipeFfmpegSegment(ffmpegPath, liveUrl, writer, signal, remaining, cookies)

      // Read actual file size from disk — always authoritative
      try {
        fileSize = statSync(filepath).size
      } catch {
        // File may not be accessible; leave fileSize at last known value
      }

      // Report progress after each segment
      const now = Date.now()
      const e = elapsed()
      if (onProgress && now - lastProgressTime >= 1000) {
        lastProgressTime = now
        const speed = e > 0 ? fileSize / e : 0
        onProgress({ bytes: fileSize, elapsed: e, speed })
      }

      if (signal.aborted) break
      if (maxDuration > 0 && e >= maxDuration) {
        logger?.info(`Duration limit reached (${maxDuration}s)`)
        break
      }
      if (!getNextUrl) break

      const nextUrl = await getNextUrl()
      if (!nextUrl) {
        logger?.info("No new stream URL — recording finished")
        break
      }
      liveUrl = nextUrl
    }
  } catch (err) {
    logger?.error(`Recording error: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await new Promise<void>((resolve) => writer.end(resolve))
  }

  const duration = elapsed()
  // Final authoritative size after flush
  try {
    fileSize = statSync(filepath).size
  } catch {
    // keep last known value
  }
  if (onProgress) {
    onProgress({
      bytes: fileSize,
      elapsed: duration,
      speed: duration > 0 ? fileSize / duration : 0,
    })
  }
  logger?.info(
    `Recording finished: ${filename} (${formatDuration(duration)}, ${bytesToHuman(fileSize)})`,
  )

  return { file: filepath, duration, size: fileSize }
}
