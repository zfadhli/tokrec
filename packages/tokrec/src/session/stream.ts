/**
 * Stream downloader — downloads a live stream to disk using FFmpeg.
 *
 * Both FLV and HLS streams are downloaded via FFmpeg subprocess with
 * transparent reconnection for transient network drops. Routes to the
 * appropriate downloader based on URL format. Cancellation comes from the
 * session's AbortScope — this module owns no controller.
 */

import { downloadStream } from "../adapters/media/download"
import type { DownloadResult, ProgressInfo } from "../domain/media"
import type { Logger } from "../lib/logger"
import { ensureDir } from "../lib/utils"

export interface StreamDownloader {
  /** Download a live stream. Resolves when the stream ends or is aborted. */
  download: (
    liveUrl: string,
    user: string,
    outputDir: string,
    maxDuration: number | undefined,
    onProgress: ((info: ProgressInfo) => void) | undefined,
    /** Called when a stream segment ends and we attempt to fetch a fresh URL. */
    getNextUrl: (() => Promise<string | null>) | undefined,
    /** Cookies to pass to FFmpeg for CDN auth. */
    cookies: Record<string, string> | undefined,
    signal: AbortSignal,
  ) => Promise<DownloadResult>
}

export function createStreamDownloader(logger?: Logger): StreamDownloader {
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
    cookies?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<DownloadResult> {
    ensureDir(outputDir)

    return downloadStream(
      liveUrl,
      user,
      outputDir,
      maxDuration,
      onProgress,
      getNextUrl,
      signal ?? new AbortController().signal,
      logger,
      isHlsUrl(liveUrl) ? "HLS" : undefined,
      cookies,
    )
  }

  return { download }
}
