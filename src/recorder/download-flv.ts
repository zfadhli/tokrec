/**
 * FLV stream downloader — downloads a live FLV stream via FFmpeg stdout pipe.
 *
 * FFmpeg handles HTTP reconnection via -reconnect flags. When TikTok's
 * short-lived stream URL expires, FFmpeg exits and the outer loop fetches
 * a fresh URL via getNextUrl.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { join } from "node:path"
import { TikTokError } from "../config"
import type { Logger } from "../logger"
import { bytesToHuman, formatFilename } from "../utils"
import { FFMPEG_STARTUP_TIMEOUT, findFfmpegPath, formatDuration } from "./ffmpeg-utils"
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
  let currentProc: ChildProcess | null = null

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
      currentProc = proc

      let stderr = ""
      let firstDataTimer: ReturnType<typeof setTimeout> | null = null

      proc.stderr?.on("data", (chunk: Buffer) => {
        if (firstDataTimer) clearTimeout(firstDataTimer)
        firstDataTimer = null
        stderr += chunk.toString()
        if (stderr.length > 10000) stderr = stderr.slice(-5000)
      })

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
              `FFmpeg startup timed out after ${FFMPEG_STARTUP_TIMEOUT / 1000}s`,
            ),
          )
        }, FFMPEG_STARTUP_TIMEOUT)

        proc.on("close", (code) => {
          if (firstDataTimer) clearTimeout(firstDataTimer)
          if (signal.aborted) {
            resolve()
            return
          }
          if (code === 0 || code === null) {
            resolve()
            return
          }
          reject(
            new TikTokError(
              "ffmpeg-error",
              `FFmpeg exited with code ${code}\n${stderr.slice(-500)}`,
            ),
          )
        })
        proc.on("error", (err) => {
          if (firstDataTimer) clearTimeout(firstDataTimer)
          if (err instanceof Error && err.name === "AbortError") return
          reject(err)
        })
      })

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
    if (currentProc && !currentProc.killed) currentProc.kill("SIGTERM")
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
