/**
 * Stream downloader — fetches a FLV stream and writes it to disk with buffering.
 * Cuts the stream into segments (default 20 min) to avoid long-running file corruption.
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
  /** Download a live stream. Resolves with one result per segment when the stream ends or is aborted. */
  download: (
    liveUrl: string,
    user: string,
    outputDir: string,
    maxDuration?: number,
    segmentMinutes?: number,
    onSegment?: (result: DownloadResult) => void | Promise<void>,
  ) => Promise<DownloadResult[]>
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
    segmentMinutes = 20,
    onSegment?: (result: DownloadResult) => void | Promise<void>,
  ): Promise<DownloadResult[]> {
    abortFlag = false
    ensureDir(outputDir)

    const segmentDurationSec = segmentMinutes * 60
    const results: DownloadResult[] = []
    let totalElapsed = 0
    let segmentIndex = 1

    // Fetch the stream
    const response = await fetch(liveUrl)
    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch stream: ${response.status}`)
    }

    streamReader = response.body.getReader()
    const reader = streamReader

    try {
      let streamEnded = false

      while (!abortFlag && !streamEnded) {
        const segmentStartTime = Date.now()
        const filename = formatFilename(user, 'flv', segmentIndex)
        const filepath = join(outputDir, filename)
        logger?.info(`Recording segment ${segmentIndex}: ${filename}`)

        const writer = createWriteStream(filepath)
        let segmentBytes = 0
        let buffer = Buffer.alloc(0)
        let segmentDone = false

        while (!abortFlag && !segmentDone) {
          const { done, value } = await reader.read()
          if (done) {
            streamEnded = true
            segmentDone = true
            break
          }

          // Accumulate into buffer
          buffer = Buffer.concat([buffer, Buffer.from(value)])

          // Flush when buffer is full (512 KB)
          if (buffer.length >= 512 * 1024) {
            await writeBuffer(writer, buffer)
            segmentBytes += buffer.length
            buffer = Buffer.alloc(0)
          }

          // Check segment time limit
          const segmentElapsed = (Date.now() - segmentStartTime) / 1000
          if (segmentElapsed >= segmentDurationSec) {
            segmentDone = true
          }
        }

        // Flush remaining buffer
        if (buffer.length > 0) {
          await writeBuffer(writer, buffer)
          segmentBytes += buffer.length
        }
        // Ensure all data is flushed to disk before the onSegment callback fires
        await new Promise<void>((resolve) => writer.end(resolve))

        const segDuration = (Date.now() - segmentStartTime) / 1000
        totalElapsed += segDuration

        logger?.info(
          `Segment ${segmentIndex} finished: ${filename} (${formatDuration(segDuration)}, ${bytesToHuman(segmentBytes)})`,
        )

        const result: DownloadResult = {
          file: filepath,
          duration: segDuration,
          size: segmentBytes,
        }
        results.push(result)

        // Fire callback so orchestrator can convert while next segment downloads
        await onSegment?.(result)

        // Check total duration limit
        if (maxDuration > 0 && totalElapsed >= maxDuration) {
          logger?.info(`Duration limit reached (${maxDuration}s)`)
          break
        }

        segmentIndex++
      }

      // Log summary across all segments
      const totalBytes = results.reduce((sum, r) => sum + r.size, 0)
      const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)
      logger?.info(
        `Recording finished: ${results.length} segment(s) (${formatDuration(totalDuration)}, ${bytesToHuman(totalBytes)})`,
      )

      return results
    } catch (err) {
      abort()
      logger?.error(`Recording error: ${err instanceof Error ? err.message : String(err)}`)
      return results
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
