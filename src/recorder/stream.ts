/**
 * Stream downloader — downloads a live stream to disk using FFmpeg.
 *
 * Both FLV and HLS streams are downloaded via FFmpeg subprocess with
 * transparent reconnection for transient network drops. Routes to the
 * appropriate downloader based on URL format.
 */

import type { Logger } from "../logger"
import { ensureDir } from "../utils"
import { downloadHls } from "./download-hls"
import { downloadFlv } from "./download-stream"

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
  }

  function isHlsUrl(url: string): boolean {
    return url.includes(".m3u8")
  }

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
      return downloadHls(
        liveUrl,
        user,
        outputDir,
        maxDuration,
        onProgress,
        abortController.signal,
        logger,
      )
    }

    return downloadFlv(
      liveUrl,
      user,
      outputDir,
      maxDuration,
      onProgress,
      getNextUrl,
      abortController.signal,
      logger,
    )
  }

  return { download, abort }
}
