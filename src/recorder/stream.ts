/**
 * Stream downloader — fetches a FLV stream and writes it to disk with buffering.
 * Supports transparent reconnection when TikTok stream segments end naturally.
 */

import { type WriteStream, createWriteStream } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../logger";
import { bytesToHuman, ensureDir, formatFilename } from "../utils";

export interface ProgressInfo {
  bytes: number;
  elapsed: number;
  speed: number;
}

export interface DownloadResult {
  file: string;
  duration: number;
  size: number;
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
  ) => Promise<DownloadResult>;
  /** Abort an active download */
  abort: () => void;
}

export function createStreamDownloader(logger?: Logger): StreamDownloader {
  let abortFlag = false;
  let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  function abort(): void {
    abortFlag = true;
    streamReader?.cancel().catch(() => {});
  }

  async function openReader(
    url: string,
  ): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch stream: ${response.status}`);
    }
    return response.body.getReader();
  }

  async function download(
    liveUrl: string,
    user: string,
    outputDir: string,
    maxDuration = 0,
    onProgress?: (info: ProgressInfo) => void,
    getNextUrl?: () => Promise<string | null>,
  ): Promise<DownloadResult> {
    abortFlag = false;
    ensureDir(outputDir);

    const filename = formatFilename(user, "flv");
    const filepath = join(outputDir, filename);
    logger?.info(`Recording: ${filename}`);

    const startTime = Date.now();
    let totalBytes = 0;
    let lastProgressTime = 0;

    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = await openReader(liveUrl);
    } catch (err) {
      throw new Error(
        `Failed to open stream: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    streamReader = reader;

    const writer = createWriteStream(filepath);

    /** Shared across try (read loop) and catch (error handler). */
    function elapsed(): number {
      return (Date.now() - startTime) / 1000;
    }

    try {
      const bufferSize = 512 * 1024; // 512 KB buffer
      let buffer = Buffer.alloc(0);

      function reportProgress(bytes: number): void {
        if (!onProgress) return;
        const now = Date.now();
        const e = elapsed();
        const speed = e > 0 ? bytes / e : 0;
        // Throttle to at most once per second to avoid flooding the UI
        if (now - lastProgressTime >= 1000) {
          lastProgressTime = now;
          onProgress({ bytes, elapsed: e, speed });
        }
      }

      /** Try to reconnect to a fresh stream URL. Returns true if reconnected. */
      async function tryReconnect(): Promise<boolean> {
        if (abortFlag) return false;
        if (!getNextUrl) return false;
        if (maxDuration > 0 && elapsed() >= maxDuration) return false;

        logger?.info("Stream ended, attempting reconnection...");
        const nextUrl = await getNextUrl();
        if (!nextUrl) {
          logger?.info("No new stream URL — recording finished");
          return false;
        }

        logger?.info(`Reconnecting to new stream URL: ${nextUrl}`);
        try {
          // Cancel old reader before opening new connection
          reader.cancel().catch(() => {});
          reader = await openReader(nextUrl);
          streamReader = reader;
          logger?.info("Reconnected successfully");
          return true;
        } catch (err) {
          logger?.error(
            `Reconnection failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return false;
        }
      }

      while (!abortFlag) {
        let chunk: { done: boolean; value?: Uint8Array };

        try {
          const result = await timeout(
            reader.read(),
            60_000,
            "Stream read timed out",
          );
          chunk = result;
        } catch (err) {
          // Read timeout — the TCP connection may have dropped silently.
          // Give TikTok a fresh URL if the stream is still live.
          logger?.info("Read timed out, attempting reconnection...");
          if (await tryReconnect()) {
            continue;
          }
          // No reconnection available — propagate the error so the caller
          // at least gets whatever bytes were buffered.
          throw err;
        }

        if (chunk.done) {
          // TikTok stream segments are short-lived (30-60s).
          // When one ends, fetch a fresh URL and keep recording.
          if (await tryReconnect()) {
            continue;
          }
          break; // no reconnection → recording is truly done
        }

        // Accumulate into buffer. chunk.value is guaranteed defined when done=false.
        buffer = Buffer.concat([buffer, Buffer.from(chunk.value!)]);

        // Flush when buffer is full
        if (buffer.length >= bufferSize) {
          await writeBuffer(writer, buffer);
          totalBytes += buffer.length;
          buffer = Buffer.alloc(0);
        }

        // Check duration limit
        if (maxDuration > 0) {
          const e = elapsed();
          if (e >= maxDuration) {
            logger?.info(`Duration limit reached (${maxDuration}s)`);
            break;
          }
        }

        // Report progress after each chunk (throttled to 1s internally)
        reportProgress(totalBytes);
      }

      // Flush remaining buffer and ensure all data is on disk
      if (buffer.length > 0) {
        await writeBuffer(writer, buffer);
        totalBytes += buffer.length;
      }
      await new Promise<void>((resolve) => writer.end(resolve));

      const duration = elapsed();
      // Final progress report
      if (onProgress) {
        onProgress({
          bytes: totalBytes,
          elapsed: duration,
          speed: duration > 0 ? totalBytes / duration : 0,
        });
      }
      logger?.info(
        `Recording finished: ${filename} (${formatDuration(duration)}, ${bytesToHuman(totalBytes)})`,
      );

      return { file: filepath, duration, size: totalBytes };
    } catch (err) {
      abort();
      const duration = elapsed();
      logger?.error(
        `Recording error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { file: filepath, duration, size: totalBytes };
    } finally {
      streamReader = null;
    }
  }

  return { download, abort };
}

function writeBuffer(writer: WriteStream, buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.write(buffer, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}

/** Race a promise against a timeout. The losing promise is ignored (no unhandled rejection). */
function timeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
