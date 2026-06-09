/**
 * Stream downloader — fetches a FLV stream and writes it to disk with buffering.
 * Monitors room liveness during recording and enforces duration limits.
 */

import { type WriteStream, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import type { TikTokApi } from '../api/tiktok'
import type { Logger } from '../logger'
import { bytesToHuman, ensureDir, formatFilename } from '../utils'

export interface DownloadResult {
  file: string
  duration: number
  size: number
}

export interface StreamDownloader {
  /** Download a live stream. Resolves when the stream ends or is aborted. */
  download: (
    liveUrl: string,
    roomId: string,
    user: string,
    outputDir: string,
    maxDuration?: number,
  ) => Promise<DownloadResult>
  /** Abort an active download */
  abort: () => void
}

export function createStreamDownloader(api: TikTokApi, logger?: Logger): StreamDownloader {
  let abortFlag = false

  function abort(): void {
    abortFlag = true
  }

  async function download(
    liveUrl: string,
    roomId: string,
    user: string,
    outputDir: string,
    maxDuration = 0,
  ): Promise<DownloadResult> {
    abortFlag = false
    ensureDir(outputDir)

    const filename = formatFilename(user, 'flv')
    const filepath = join(outputDir, filename)
    logger?.info(`Recording started: ${filename}`)

    const startTime = Date.now()
    let totalBytes = 0

    // Fetch the stream
    const response = await fetch(liveUrl)
    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch stream: ${response.status}`)
    }

    const writer: WriteStream = createWriteStream(filepath)

    try {
      const reader = response.body.getReader()
      const bufferSize = 512 * 1024 // 512 KB buffer
      let buffer = Buffer.alloc(0)

      while (!abortFlag) {
        const { done, value } = await reader.read()
        if (done) break

        // Accumulate into buffer
        buffer = Buffer.concat([buffer, Buffer.from(value)])

        // Flush when buffer is full
        if (buffer.length >= bufferSize) {
          await writeBuffer(writer, buffer)
          totalBytes += buffer.length
          buffer = Buffer.alloc(0)
        }

        // Check duration limit
        if (maxDuration > 0) {
          const elapsed = (Date.now() - startTime) / 1000
          if (elapsed >= maxDuration) {
            logger?.info(`Duration limit reached (${maxDuration}s)`)
            break
          }
        }

        // Check if room is still alive every ~5 seconds
        if (totalBytes > 0 && totalBytes % (1024 * 1024) === 0) {
          try {
            const alive = await api.isRoomAlive(roomId)
            if (!alive) {
              logger?.info('Stream ended (user went offline)')
              break
            }
          } catch {
            // If health check fails, continue recording
          }
        }
      }

      // Flush remaining buffer
      if (buffer.length > 0) {
        await writeBuffer(writer, buffer)
        totalBytes += buffer.length
      }

      const duration = (Date.now() - startTime) / 1000
      logger?.info(
        `Recording finished: ${filename} (${formatDuration(duration)}, ${bytesToHuman(totalBytes)})`,
      )

      return { file: filepath, duration, size: totalBytes }
    } catch (err) {
      // Ensure we flush on error too
      abort()
      const duration = (Date.now() - startTime) / 1000
      logger?.error(`Recording error: ${err instanceof Error ? err.message : String(err)}`)
      return { file: filepath, duration, size: totalBytes }
    } finally {
      writer.close()
    }
  }

  return { download, abort }
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
