/**
 * Stream downloader — fetches a FLV stream and writes it to disk with buffering.
 */

import { type WriteStream, createWriteStream } from 'node:fs'
import { join } from 'node:path'
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
    user: string,
    outputDir: string,
    maxDuration?: number,
  ) => Promise<DownloadResult>
  /** Abort an active download */
  abort: () => void
}

export function createStreamDownloader(logger?: Logger): StreamDownloader {
  let abortFlag = false
  let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null

  function abort(): void {
    abortFlag = true
    streamReader?.cancel().catch(() => {})
  }

  async function download(
    liveUrl: string,
    user: string,
    outputDir: string,
    maxDuration = 0,
  ): Promise<DownloadResult> {
    abortFlag = false
    ensureDir(outputDir)

    const filename = formatFilename(user, 'flv')
    const filepath = join(outputDir, filename)
    logger?.info(`Recording: ${filename}`)

    const startTime = Date.now()
    let totalBytes = 0

    // Fetch the stream
    const response = await fetch(liveUrl)
    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch stream: ${response.status}`)
    }

    const writer = createWriteStream(filepath)

    try {
      streamReader = response.body.getReader()
      const reader = streamReader
      const bufferSize = 512 * 1024 // 512 KB buffer
      let buffer = Buffer.alloc(0)

      while (!abortFlag) {
        const { done, value } = await timeout(reader.read(), 60_000, 'Stream read timed out')
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

        // Log progress every ~10 MB
        if (totalBytes > 0 && totalBytes % (10 * 1024 * 1024) === 0) {
          const elapsed = (Date.now() - startTime) / 1000
          logger?.info(
            `Still recording... ${bytesToHuman(totalBytes)} downloaded after ${formatDuration(elapsed)}`,
          )
        }
      }

      // Flush remaining buffer and ensure all data is on disk
      if (buffer.length > 0) {
        await writeBuffer(writer, buffer)
        totalBytes += buffer.length
      }
      await new Promise<void>((resolve) => writer.end(resolve))

      const duration = (Date.now() - startTime) / 1000
      logger?.info(
        `Recording finished: ${filename} (${formatDuration(duration)}, ${bytesToHuman(totalBytes)})`,
      )

      return { file: filepath, duration, size: totalBytes }
    } catch (err) {
      abort()
      const duration = (Date.now() - startTime) / 1000
      logger?.error(`Recording error: ${err instanceof Error ? err.message : String(err)}`)
      return { file: filepath, duration, size: totalBytes }
    } finally {
      streamReader = null
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
