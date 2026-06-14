/**
 * HLS stream downloader — downloads a live HLS stream via FFmpeg subprocess.
 *
 * FFmpeg handles M3U8 playlist fetching and .ts segment concatenation.
 * The -reconnect flags handle transient CDN drops.
 */

import { spawn } from "node:child_process"
import { statSync } from "node:fs"
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
  signal: AbortSignal,
  logger?: Logger,
): Promise<DownloadResult> {
  const filename = formatFilename(user, "ts")
  const filepath = join(outputDir, filename)
  logger?.info(`Recording (HLS): ${filename}`)

  const startTime = Date.now()
  let lastProgressTime = 0

  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    throw new TikTokError(
      "ffmpeg-not-found",
      "FFmpeg not found — required for HLS streams. Install it:\n" +
        "  Linux:  apt install ffmpeg\n  macOS:  brew install ffmpeg",
    )
  }

  const args = [
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
    "-y",
    filepath,
  ]

  return new Promise<DownloadResult>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    })

    let stderr = ""

    // Startup timeout: kill FFmpeg if no stderr output received within window
    let firstDataTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
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

    proc.stderr?.on("data", (chunk: Buffer) => {
      if (firstDataTimer) clearTimeout(firstDataTimer)
      firstDataTimer = null
      stderr += chunk.toString()
      if (stderr.length > 10000) stderr = stderr.slice(-5000)
    })

    // Poll output file size for progress reporting
    const progressTimer = setInterval(() => {
      if (onProgress) {
        try {
          const stats = statSync(filepath)
          const elapsed = (Date.now() - startTime) / 1000
          const speed = elapsed > 0 ? stats.size / elapsed : 0
          const now = Date.now()
          if (now - lastProgressTime >= 1000) {
            lastProgressTime = now
            onProgress({ bytes: stats.size, elapsed, speed })
          }
        } catch {
          // File not created yet (FFmpeg still initializing) — skip
        }
      }
    }, 1000)

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
      clearInterval(progressTimer)
      if (maxDurationTimer) clearTimeout(maxDurationTimer)

      if (signal.aborted) {
        // Aborted by user — return whatever we have
        try {
          const stats = statSync(filepath)
          const duration = (Date.now() - startTime) / 1000
          logger?.info(
            `Recording finished: ${filename} (${formatDuration(duration)}, ${bytesToHuman(stats.size)})`,
          )
          resolve({ file: filepath, duration, size: stats.size })
        } catch {
          resolve({ file: filepath, duration: 0, size: 0 })
        }
        return
      }

      // Normal completion or error
      try {
        const stats = statSync(filepath)
        const duration = (Date.now() - startTime) / 1000
        if (onProgress) {
          onProgress({
            bytes: stats.size,
            elapsed: duration,
            speed: duration > 0 ? stats.size / duration : 0,
          })
        }
        logger?.info(
          `Recording finished: ${filename} (${formatDuration(duration)}, ${bytesToHuman(stats.size)})`,
        )
        resolve({ file: filepath, duration, size: stats.size })
      } catch {
        const msg = `FFmpeg exited with code ${code}\n${stderr.slice(-500)}`
        reject(new TikTokError("ffmpeg-error", msg))
      }
    })

    proc.on("error", (err) => {
      if (firstDataTimer) clearTimeout(firstDataTimer)
      // Spawn emits AbortError when killed via signal — handled by close
      if (err instanceof Error && err.name === "AbortError") return
      clearInterval(progressTimer)
      if (maxDurationTimer) clearTimeout(maxDurationTimer)
      reject(new TikTokError("ffmpeg-error", `Failed to spawn FFmpeg: ${err.message}`))
    })
  })
}
