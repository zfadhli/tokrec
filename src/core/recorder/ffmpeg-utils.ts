/**
 * Shared FFmpeg utilities — stream-download pipe primitive and constants.
 */

import { type ChildProcess, spawn } from "node:child_process"
import type { WriteStream } from "node:fs"
import { TikTokError } from "../../lib/config"

/** Kill FFmpeg if no output is received within this window after spawn. */
export const FFMPEG_STARTUP_TIMEOUT = 30_000

/**
 * Build FFmpeg HTTP option arguments for cookies and headers.
 * TikTok's CDN requires session cookies and a Referer to serve the stream.
 */
function buildHttpArgs(cookies?: Record<string, string>): string[] {
  const args: string[] = []

  // ponytail: user-agent header, CDNs tend to be picky
  args.push(
    "-user_agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0",
  )
  args.push("-headers", "Referer: https://www.tiktok.com/\r\n")

  if (cookies && Object.keys(cookies).length > 0) {
    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("\r\n")
    args.push("-cookies", cookieStr)
  }

  return args
}

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
 * Uses child_process.spawn directly (not execa) because execa v9 defaults
 * to encoding stdout as UTF-8, which corrupts binary MPEG-TS data.
 */
export async function pipeFfmpegSegment(
  ffmpegPath: string,
  url: string,
  writer: WriteStream,
  signal: AbortSignal,
  maxDuration?: number,
  cookies?: Record<string, string>,
): Promise<void> {
  const durationArgs = maxDuration ? ["-t", String(maxDuration)] : []
  const httpArgs = buildHttpArgs(cookies)
  // ponytail: input options (-headers, -cookies, -user_agent) must come before -i
  const args = [...httpArgs, "-i", url, ...durationArgs, ...FFMPEG_BASE_ARGS]
  const proc: ChildProcess = spawn(ffmpegPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  })

  let stderr = ""
  let firstDataTimer: ReturnType<typeof setTimeout> | null = null

  const clearStartupTimer = () => {
    if (firstDataTimer) {
      clearTimeout(firstDataTimer)
      firstDataTimer = null
    }
  }

  // Forward abort signal to process
  const onAbort = () => {
    if (!proc.killed) proc.kill("SIGTERM")
  }
  signal.addEventListener("abort", onAbort, { once: true })

  proc.stderr?.on("data", (chunk: Buffer) => {
    clearStartupTimer()
    stderr += chunk.toString()
    if (stderr.length > 10000) stderr = stderr.slice(-5000)
  })

  proc.stdout?.on("data", (chunk: Buffer) => {
    clearStartupTimer()
    const canContinue = writer.write(chunk)
    if (!canContinue) {
      proc.stdout?.pause()
      writer.once("drain", () => proc.stdout?.resume())
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
      signal.removeEventListener("abort", onAbort)
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
      signal.removeEventListener("abort", onAbort)
      reject(err)
    })
  })
}
