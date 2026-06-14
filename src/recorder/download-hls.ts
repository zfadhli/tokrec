/**
 * HLS stream downloader — downloads a live HLS stream via FFmpeg subprocess.
 *
 * FFmpeg handles M3U8 playlist fetching and .ts segment concatenation.
 * The -reconnect flags handle transient CDN drops. When the playlist URL
 * expires, getNextUrl fetches a fresh URL and FFmpeg is respawned.
 */

import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { join } from "node:path"
import { TikTokError } from "../config"
import type { Logger } from "../logger"
import { bytesToHuman, formatFilename } from "../utils"
import { FFMPEG_STARTUP_TIMEOUT, findFfmpegPath, formatDuration } from "./ffmpeg-utils"
import type { DownloadResult, ProgressInfo } from "./stream"

export async function downloadHls(
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
  logger?.info(`Recording (HLS): ${filename}`)

  const startTime = Date.now()
  let totalBytes = 0
  let lastProgressTime = 0

  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    throw new TikTokError(
      "ffmpeg-not-found",
      "FFmpeg not found — required for HLS streams. Install it:\n" +
        "  Linux:  apt install ffmpeg\n  macOS:  brew install ffmpeg",
    )
  }

  function elapsed(): number {
    return (Date.now() - startTime) / 1000
  }

  const writer = createWriteStream(filepath)

  try {
    while (!signal.aborted) {
      const proc = spawn(
        ffmpegPath,
        [
          "-reconnect",
          "1",
          "-reconnect_at_eof",
          "1",
          "-reconnect_streamed",
          "1",
          "-reconnect_delay_max",
          "5",
          "-i",
          liveUrl,
          "-c",
          "copy",
          "-f",
          "mpegts",
          "pipe:1",
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          signal,
        },
      )

      let stderr = ""
      let firstDataTimer: ReturnType<typeof setTimeout> | null = null

      proc.stderr?.on("data", (chunk: Buffer) => {
        if (firstDataTimer) clearTimeout(firstDataTimer)
        firstDataTimer = null
        stderr += chunk.toString()
        if (stderr.length > 10000) stderr = stderr.slice(-5000)
      })

      // Pipe FFmpeg stdout to file with backpressure handling
      proc.stdout.on("data", (chunk: Buffer) => {
        if (firstDataTimer) clearTimeout(firstDataTimer)
        firstDataTimer = null
        const canContinue = writer.write(chunk)
        totalBytes += chunk.length
        if (!canContinue) {
          proc.stdout.pause()
          writer.once("drain", () => proc.stdout.resume())
        }
      })

      // Startup timeout + wait for FFmpeg to finish
      await new Promise<void>((resolve, reject) => {
        firstDataTimer = setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGTERM")
            setTimeout(() => {
              if (!proc.killed) proc.kill("SIGKILL")
            }, 2000)
          }
          reject(
            new TikTokError(
              "ffmpeg-error",
              `FFmpeg startup timed out after ${FFMPEG_STARTUP_TIMEOUT / 1000}s\n${stderr.slice(-500)}`,
            ),
          )
        }, FFMPEG_STARTUP_TIMEOUT)

        // Max duration timer
        let maxDurationTimer: ReturnType<typeof setTimeout> | null = null
        if (maxDuration > 0) {
          maxDurationTimer = setTimeout(() => {
            logger?.info(`Duration limit reached (${maxDuration}s) — stopping FFmpeg`)
            if (!proc.killed) {
              proc.kill("SIGTERM")
              setTimeout(() => {
                if (!proc.killed) proc.kill("SIGKILL")
              }, 2000)
            }
          }, maxDuration * 1000)
        }

        proc.on("close", (code) => {
          if (firstDataTimer) clearTimeout(firstDataTimer)
          if (maxDurationTimer) clearTimeout(maxDurationTimer)

          if (signal.aborted) {
            resolve()
            return
          }
          // URL expired or stream ended — normal for live streams
          if (code === 0 || code === null) {
            resolve()
          } else {
            reject(
              new TikTokError(
                "ffmpeg-error",
                `FFmpeg exited with code ${code}\n${stderr.slice(-500)}`,
              ),
            )
          }
        })
        proc.on("error", (err) => {
          if (firstDataTimer) clearTimeout(firstDataTimer)
          if (maxDurationTimer) clearTimeout(maxDurationTimer)
          if (err instanceof Error && err.name === "AbortError") return
          reject(err)
        })
      })

      // Report progress
      const now = Date.now()
      const e = elapsed()
      if (onProgress && now - lastProgressTime >= 1000) {
        lastProgressTime = now
        const speed = e > 0 ? totalBytes / e : 0
        onProgress({ bytes: totalBytes, elapsed: e, speed })
      }

      // Check if we should continue
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
