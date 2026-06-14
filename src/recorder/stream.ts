/**
 * Stream downloader — downloads a live stream to disk using FFmpeg.
 *
 * Both FLV and HLS streams are downloaded via FFmpeg subprocess with
 * transparent reconnection for transient network drops. When a stream
 * URL expires (TikTok URLs are short-lived), the main loop fetches a
 * fresh URL via getNextUrl and spawns a new FFmpeg process.
 */

import { spawn } from "node:child_process"
import { createWriteStream, statSync } from "node:fs"
import { join } from "node:path"
import type { Logger } from "../logger"
import { bytesToHuman, ensureDir, formatFilename } from "../utils"

export interface ProgressInfo {
  bytes: number
  elapsed: number
  speed: number
}

export interface DownloadResult {
  file: string
  duration: number
  size: number
}

export interface StreamDownloader {
  /** Download a live stream. Resolves when the stream ends or is aborted. */
  download: (
    liveUrl: string,
    user: string,
    outputDir: string,
    maxDuration?: number,
    onProgress?: (info: ProgressInfo) => void,
    /** Called when a stream segment ends and we attempt to fetch a fresh URL. */
    getNextUrl?: () => Promise<string | null>,
  ) => Promise<DownloadResult>
  /** Abort an active download */
  abort: () => void
}

export function createStreamDownloader(logger?: Logger): StreamDownloader {
  let abortController = new AbortController()

  function abort(): void {
    abortController.abort()
    // All FFmpeg subprocesses are killed automatically via spawn's `signal` option
  }

  /** Detect whether a URL is an HLS (.m3u8) playlist. */
  function isHlsUrl(url: string): boolean {
    return url.includes(".m3u8")
  }

  // ─── FLV downloader (FFmpeg-based path) ──────────────────────

  async function downloadFlv(
    liveUrl: string,
    user: string,
    outputDir: string,
    maxDuration: number,
    onProgress?: (info: ProgressInfo) => void,
    getNextUrl?: () => Promise<string | null>,
  ): Promise<DownloadResult> {
    const filename = formatFilename(user, "flv")
    const filepath = join(outputDir, filename)
    logger?.info(`Recording: ${filename}`)

    const startTime = Date.now()
    let totalBytes = 0
    let lastProgressTime = 0

    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      throw new Error(
        "FFmpeg not found — required for stream download. Install it:\n" +
          "  Linux:  apt install ffmpeg\n  macOS:  brew install ffmpeg",
      )
    }

    function elapsed(): number {
      return (Date.now() - startTime) / 1000
    }

    const writer = createWriteStream(filepath)

    try {
      while (!abortController.signal.aborted) {
        // Spawn FFmpeg with reconnect flags. FFmpeg handles transient
        // network drops transparently. When the stream URL expires
        // (TikTok URLs are short-lived), FFmpeg exits and the outer
        // loop fetches a fresh URL.
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
            "flv",
            "pipe:1",
          ],
          {
            stdio: ["ignore", "pipe", "pipe"],
            signal: abortController.signal,
          },
        )

        let stderr = ""

        proc.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString()
          if (stderr.length > 10000) stderr = stderr.slice(-5000)
        })

        // Pipe FFmpeg stdout directly to file with backpressure handling
        proc.stdout.on("data", (chunk: Buffer) => {
          const canContinue = writer.write(chunk)
          totalBytes += chunk.length
          if (!canContinue) {
            proc.stdout.pause()
            writer.once("drain", () => proc.stdout.resume())
          }
        })

        // Wait for FFmpeg to finish (URL expired or stream ended)
        await new Promise<void>((resolve, reject) => {
          proc.on("close", (code) => {
            if (abortController.signal.aborted) {
              resolve()
              return
            }
            // URL expired or stream ended — normal for live streams
            if (code === 0 || code === null) {
              resolve()
            } else {
              reject(new Error(`FFmpeg exited with code ${code}\n${stderr.slice(-500)}`))
            }
          })
          proc.on("error", (err) => {
            if ((err as any)?.name === "AbortError") return
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

        // Check if we should continue
        if (abortController.signal.aborted) break
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
      abortController.abort()
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

  // ─── HLS downloader (FFmpeg-based path) ───────────────────────

  async function downloadHls(
    liveUrl: string,
    user: string,
    outputDir: string,
    maxDuration: number,
    onProgress?: (info: ProgressInfo) => void,
  ): Promise<DownloadResult> {
    const filename = formatFilename(user, "ts")
    const filepath = join(outputDir, filename)
    logger?.info(`Recording (HLS): ${filename}`)

    const startTime = Date.now()
    let lastProgressTime = 0

    // Find FFmpeg
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      throw new Error(
        "FFmpeg not found — required for HLS streams. Install it:\n" +
          "  Linux:  apt install ffmpeg\n  macOS:  brew install ffmpeg",
      )
    }

    // Spawn FFmpeg with the M3U8 URL as input.
    // FFmpeg handles downloading all .ts segments and concatenating them.
    // -reconnect flags handle transient CDN drops.
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
        signal: abortController.signal,
      })

      let stderr = ""

      proc.stderr?.on("data", (chunk: Buffer) => {
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
          if (!proc.killed) proc.kill("SIGTERM")
        }, maxDuration * 1000)
      }

      proc.on("close", (code) => {
        clearInterval(progressTimer)
        if (maxDurationTimer) clearTimeout(maxDurationTimer)

        if (abortController.signal.aborted) {
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
          reject(new Error(msg))
        }
      })

      proc.on("error", (err) => {
        // Spawn emits AbortError when killed via signal — handled by close
        if ((err as any)?.name === "AbortError") return
        clearInterval(progressTimer)
        if (maxDurationTimer) clearTimeout(maxDurationTimer)
        reject(new Error(`Failed to spawn FFmpeg: ${err.message}`))
      })
    })
  }

  // ─── Main download entry point ──────────────────────────────

  async function download(
    liveUrl: string,
    user: string,
    outputDir: string,
    maxDuration = 0,
    onProgress?: (info: ProgressInfo) => void,
    getNextUrl?: () => Promise<string | null>,
  ): Promise<DownloadResult> {
    abortController = new AbortController()
    ensureDir(outputDir)

    if (isHlsUrl(liveUrl)) {
      // HLS: FFmpeg handles playlist + segments natively.
      return downloadHls(liveUrl, user, outputDir, maxDuration, onProgress)
    }

    // FLV: FFmpeg-based path with reconnect flags and URL refresh loop
    return downloadFlv(liveUrl, user, outputDir, maxDuration, onProgress, getNextUrl)
  }

  return { download, abort }
}

/** Find FFmpeg binary via Bun.which() or PATH search. */
function findFfmpegPath(): string | null {
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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}m ${s}s`
}
