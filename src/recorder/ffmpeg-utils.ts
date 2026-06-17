/**
 * Shared FFmpeg utilities — stream-download pipe primitive and constants.
 */

import { spawn } from "node:child_process"
import type { WriteStream } from "node:fs"
import { TikTokError } from "../config"

/** Kill FFmpeg if no output is received within this window after spawn. */
export const FFMPEG_STARTUP_TIMEOUT = 30_000

/** Standard FFmpeg reconnect + mpegts pipe arguments. */
const FFMPEG_BASE_ARGS = [
  "-reconnect",
  "1",
  "-reconnect_at_eof",
  "1",
  "-reconnect_streamed",
  "1",
  "-reconnect_delay_max",
  "5",
  "-c",
  "copy",
  "-f",
  "mpegts",
  "pipe:1",
]

/**
 * Spawn an FFmpeg process to download from `url` and pipe its stdout to
 * `writer` with backpressure handling.
 *
 * Features:
 * - Transparent HTTP reconnection via FFmpeg `-reconnect` flags
 * - `FFMPEG_STARTUP_TIMEOUT` (30s) startup guard with SIGTERM → SIGKILL
 *   escalation to prevent orphaned processes
 * - Bounded stderr capture (10k chars) for error diagnostics
 * - Automatic cleanup when `signal` fires (uses spawn `signal` option)
 * - AbortError is swallowed — the promise resolves instead of rejecting,
 *   allowing the caller to check `signal.aborted` and react accordingly
 *
 * The caller is responsible for tracking file size via `statSync` — this
 * function deliberately avoids maintaining its own byte counter to prevent
 * divergence between the in-memory count and actual disk writes.
 */
export async function pipeFfmpegSegment(
  ffmpegPath: string,
  url: string,
  writer: WriteStream,
  signal: AbortSignal,
  maxDuration?: number,
): Promise<void> {
  const durationArgs = maxDuration ? ["-t", String(maxDuration)] : []
  const proc = spawn(ffmpegPath, ["-i", url, ...durationArgs, ...FFMPEG_BASE_ARGS], {
    stdio: ["ignore", "pipe", "pipe"],
    signal,
  })

  let stderr = ""
  let firstDataTimer: ReturnType<typeof setTimeout> | null = null

  const clearStartupTimer = () => {
    if (firstDataTimer) {
      clearTimeout(firstDataTimer)
      firstDataTimer = null
    }
  }

  proc.stderr?.on("data", (chunk: Buffer) => {
    clearStartupTimer()
    stderr += chunk.toString()
    if (stderr.length > 10000) stderr = stderr.slice(-5000)
  })

  proc.stdout.on("data", (chunk: Buffer) => {
    clearStartupTimer()
    const canContinue = writer.write(chunk)
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
          `FFmpeg startup timed out after ${FFMPEG_STARTUP_TIMEOUT / 1000}s\n${stderr.slice(-500)}`,
        ),
      )
    }, FFMPEG_STARTUP_TIMEOUT)

    proc.on("close", (code) => {
      clearStartupTimer()
      if (signal.aborted) {
        resolve()
        return
      }
      if (code === 0 || code === null) {
        resolve()
        return
      }
      reject(
        new TikTokError("ffmpeg-error", `FFmpeg exited with code ${code}\n${stderr.slice(-500)}`),
      )
    })

    proc.on("error", (err) => {
      clearStartupTimer()
      if (err instanceof Error && err.name === "AbortError") return
      reject(err)
    })
  })
}
