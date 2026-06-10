/**
 * Stream downloader — fetches a live stream and writes it to disk with buffering.
 *
 * FLV streams: downloaded via raw fetch() with byte buffering and transparent
 * reconnection when TikTok stream segments end naturally.
 * HLS streams: downloaded via FFmpeg (which handles M3U8 playlist + .ts segments).
 */

import { type ChildProcess, spawn } from "node:child_process"
import { createWriteStream, statSync, type WriteStream } from "node:fs"
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
  let abortFlag = false
  let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let ffmpegProcess: ChildProcess | null = null

  function abort(): void {
    abortFlag = true
    streamReader?.cancel().catch(() => {})
    if (ffmpegProcess && !ffmpegProcess.killed) {
      ffmpegProcess.kill("SIGTERM")
    }
  }

  /** Detect whether a URL is an HLS (.m3u8) playlist. */
  function isHlsUrl(url: string): boolean {
    return url.includes(".m3u8")
  }

  // ─── FLV downloader (existing fetch-based path) ────────────────

  async function openReader(url: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch stream: ${response.status}`)
    }
    return response.body.getReader()
  }

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

    let reader: ReadableStreamDefaultReader<Uint8Array>
    try {
      reader = await openReader(liveUrl)
    } catch (err) {
      throw new Error(`Failed to open stream: ${err instanceof Error ? err.message : String(err)}`)
    }
    streamReader = reader

    const writer = createWriteStream(filepath)

    function elapsed(): number {
      return (Date.now() - startTime) / 1000
    }

    try {
      const bufferSize = 512 * 1024 // 512 KB buffer
      let buffer = Buffer.alloc(0)

      function reportProgress(bytes: number): void {
        if (!onProgress) return
        const now = Date.now()
        const e = elapsed()
        const speed = e > 0 ? bytes / e : 0
        if (now - lastProgressTime >= 1000) {
          lastProgressTime = now
          onProgress({ bytes, elapsed: e, speed })
        }
      }

      /** Try to reconnect to a fresh stream URL. Returns true if reconnected. */
      async function tryReconnect(): Promise<boolean> {
        if (abortFlag) return false
        if (!getNextUrl) return false
        if (maxDuration > 0 && elapsed() >= maxDuration) return false

        logger?.info("Stream ended, attempting reconnection...")
        const nextUrl = await getNextUrl()
        if (!nextUrl) {
          logger?.info("No new stream URL — recording finished")
          return false
        }

        logger?.info(`Reconnecting to new stream URL: ${nextUrl}`)
        try {
          reader.cancel().catch(() => {})
          reader = await openReader(nextUrl)
          streamReader = reader
          logger?.info("Reconnected successfully")
          return true
        } catch (err) {
          logger?.error(`Reconnection failed: ${err instanceof Error ? err.message : String(err)}`)
          return false
        }
      }

      while (!abortFlag) {
        let chunk: { done: boolean; value?: Uint8Array }

        try {
          const result = await timeout(reader.read(), 60_000, "Stream read timed out")
          chunk = result
        } catch (err) {
          logger?.info("Read timed out, attempting reconnection...")
          if (await tryReconnect()) {
            continue
          }
          throw err
        }

        if (chunk.done) {
          if (await tryReconnect()) {
            continue
          }
          break
        }

        buffer = Buffer.concat([buffer, Buffer.from(chunk.value!)])

        if (buffer.length >= bufferSize) {
          await writeBuffer(writer, buffer)
          totalBytes += buffer.length
          buffer = Buffer.alloc(0)
        }

        if (maxDuration > 0) {
          const e = elapsed()
          if (e >= maxDuration) {
            logger?.info(`Duration limit reached (${maxDuration}s)`)
            break
          }
        }

        reportProgress(totalBytes)
      }

      if (buffer.length > 0) {
        await writeBuffer(writer, buffer)
        totalBytes += buffer.length
      }
      await new Promise<void>((resolve) => writer.end(resolve))

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
    } catch (err) {
      abort()
      const duration = elapsed()
      logger?.error(`Recording error: ${err instanceof Error ? err.message : String(err)}`)
      return { file: filepath, duration, size: totalBytes }
    } finally {
      streamReader = null
    }
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
    const args = ["-i", liveUrl, "-c", "copy", "-y", filepath]

    return new Promise<DownloadResult>((resolve, reject) => {
      const proc = spawn(ffmpegPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      })
      ffmpegProcess = proc

      let stderr = ""

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString()
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
        ffmpegProcess = null

        if (abortFlag) {
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
        clearInterval(progressTimer)
        if (maxDurationTimer) clearTimeout(maxDurationTimer)
        ffmpegProcess = null
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
    abortFlag = false
    ensureDir(outputDir)

    if (isHlsUrl(liveUrl)) {
      // HLS: FFmpeg handles playlist + segments natively.
      // Reconnection is not needed (FFmpeg refreshes the playlist internally).
      return downloadHls(liveUrl, user, outputDir, maxDuration, onProgress)
    }

    // FLV: existing fetch-based path with reconnection support
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

function writeBuffer(writer: WriteStream, buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.write(buffer, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}m ${s}s`
}

/** Race a promise against a timeout. The losing promise is ignored (no unhandled rejection). */
function timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms)
    promise.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
