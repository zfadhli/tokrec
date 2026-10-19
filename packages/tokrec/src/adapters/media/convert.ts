/**
 * Converter — the media-processing capability `RecordingJob` depends on.
 *
 * Remux (TS → MP4) and segment both delegate to `ffmpeg-utils.runFfmpeg`, so
 * the job never builds an FFmpeg command line.
 */

import { unlinkSync } from "node:fs"
import type { Logger } from "../../lib/logger"
import { runFfmpeg } from "./ffmpeg-utils"

export interface Converter {
  /** Convert a TS file to MP4 (stream copy). Deletes the original on success. */
  convert: (input: string) => Promise<string>
  /** Split a file into `<name>_partN.mp4`; returns FFmpeg's CSV segment listing. */
  segment: (input: string, segmentSeconds: number, outputPattern: string) => Promise<string>
}

export function createConverter(logger?: Logger, signal?: AbortSignal): Converter {
  async function convert(input: string): Promise<string> {
    const output = input.replace(/\.(flv|ts)$/i, ".mp4")

    logger?.info(`Converting: ${input} → ${output}`)

    await runFfmpeg(["-i", input, "-c", "copy", "-y", output], signal)

    // Delete original TS
    try {
      unlinkSync(input)
      logger?.info(`Deleted original: ${input}`)
    } catch {
      logger?.warn(`Could not delete original: ${input}`)
    }

    logger?.info(`Converted: ${output}`)
    return output
  }

  async function segment(
    input: string,
    segmentSeconds: number,
    outputPattern: string,
  ): Promise<string> {
    return runFfmpeg(
      [
        "-i",
        input,
        "-c",
        "copy",
        "-f",
        "segment",
        "-segment_time",
        String(segmentSeconds),
        "-reset_timestamps",
        "1",
        "-segment_start_number",
        "1",
        "-segment_list",
        "pipe:1",
        "-segment_list_type",
        "csv",
        outputPattern,
      ],
      signal,
    )
  }

  return { convert, segment }
}
