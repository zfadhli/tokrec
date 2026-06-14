/**
 * Live stream downloader — downloads a live stream via FFmpeg stdout pipe.
 *
 * Outputs MPEG-TS (.ts) format, which is crash-safe and append-friendly.
 * FFmpeg handles HTTP reconnection via -reconnect flags. When TikTok's
 * short-lived stream URL expires, FFmpeg exits and the outer loop fetches
 * a fresh URL via getNextUrl.
 */

import { createWriteStream } from "node:fs"
import { join } from "node:path"
import { TikTokError } from "../config"
import type { Logger } from "../logger"
import { bytesToHuman, formatFilename } from "../utils"
import { findFfmpegPath, formatDuration, pipeFfmpegSegment } from "./ffmpeg-utils"
import type { DownloadResult, ProgressInfo } from "./stream"

export async function downloadFlv(
  liveUrl: string,
  user: string,
  outputDir: string,
  maxDuration: number,
  onProgress: ((info: ProgressInfo) => void) | undefined,
  getNextUrl: (() => Promise<string | null>) | undefined,
  signal: AbortSignal,
  logger?: Logger,
): Promise<DownloadResult> {
  const filename = formatFilename(user, "ts")
  const filepath = join(outputDir, filename)
  logger?.info(`Recording: ${filename}`)

  const startTime = Date.now()
  let totalBytes = 0
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
      const { bytes } = await pipeFfmpegSegment(ffmpegPath, liveUrl, writer, signal)
      totalBytes += bytes

      // Report progress after each segment
      const now = Date.now()
      const e = elapsed()
      if (onProgress && now - lastProgressTime >= 1000) {
        lastProgressTime = now
        const speed = e > 0 ? totalBytes / e : 0
        onProgress({ bytes: totalBytes, elapsed: e, speed })
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
  if (onProgress) {
    onProgress({
      bytes: totalBytes,
      elapsed: duration,
      speed: duration > 0 ? totalBytes / duration : 0,
    })
  }
  logger?.info(
    `Recording finished: ${filename} (${formatDuration(duration)}, ${bytesToHuman(totalBytes)})`,
  )

  return { file: filepath, duration, size: totalBytes }
}
