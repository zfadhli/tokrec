/**
 * Audio normalizer — wraps peaknorm's EBU R128 loudness normalization.
 * Runs after conversion/segmenting to normalize the final MP4 audio.
 */

import type { NormalizeResult } from "peaknorm"
import { normalizeFile } from "peaknorm"
import type { Logger } from "../logger"

export interface AudioNormalizer {
  /** Normalize a single audio/video file. Returns the normalize result. */
  normalize(file: string): Promise<NormalizeResult>
}

export interface AudioNormalizerOptions {
  /** Target loudness in LUFS (default: -14). */
  loudness: number
  /** Audio codec for output (default: "aac"). */
  audioCodec: string
  /** Audio bitrate for output (default: "128k"). */
  audioBitrate: string
  /** Called when a file starts normalization. */
  onStart?: (file: string) => void
  /** Called with progress updates (percent 0-100, phase "analyzing"|"normalizing"). */
  onProgress?: (file: string, percent: number, phase: string) => void
  /** Called when a file completes normalization successfully. */
  onComplete?: (result: NormalizeResult) => void
  /** Called when a file errors during normalization. */
  onError?: (file: string, error: Error) => void
}

export function createAudioNormalizer(
  opts: AudioNormalizerOptions,
  logger?: Logger,
): AudioNormalizer {
  return {
    async normalize(file: string): Promise<NormalizeResult> {
      logger?.info(`Normalizing audio: ${file}`)
      opts.onStart?.(file)

      try {
        const result = await normalizeFile(file, {
          loudness: opts.loudness,
          audioCodec: opts.audioCodec,
          audioBitrate: opts.audioBitrate,
          backup: false,
          onFileProgress: (f, percent, phase) => {
            opts.onProgress?.(f, percent, phase)
          },
        })

        logger?.info(`Audio normalized: ${result.output}`)
        opts.onComplete?.(result)
        return result
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        logger?.error(`Audio normalization failed: ${error.message}`)
        opts.onError?.(file, error)
        throw error
      }
    },
  }
}
