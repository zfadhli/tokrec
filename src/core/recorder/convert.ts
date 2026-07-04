/**
 * Converter — spawns FFmpeg to convert TS → MP4 (stream copy by default).
 * Deletes the original file on success.
 */

import { unlinkSync } from "node:fs"
import { execa } from "execa"
import { TikTokError } from "../../lib/config"
import type { Logger } from "../../lib/logger"
import { findFfmpegPath } from "../../lib/utils"

export interface Converter {
  /** Convert a TS file to MP4. Returns the output filepath. */
  convert: (input: string) => Promise<string>
}

export function createConverter(logger?: Logger, signal?: AbortSignal): Converter {
  async function convert(input: string): Promise<string> {
    const output = input.replace(/\.(flv|ts)$/i, ".mp4")

    logger?.info(`Converting: ${input} → ${output}`)

    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      throw new TikTokError(
        "ffmpeg-not-found",
        "FFmpeg not found. Install it:\n" +
          "  Linux:  apt install ffmpeg / brew install ffmpeg / pacman -S ffmpeg\n" +
          "  macOS:  brew install ffmpeg\n" +
          "  Windows: choco install ffmpeg",
      )
    }

    await runFfmpeg(ffmpegPath, input, output, signal)

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

  return { convert }
}

async function runFfmpeg(
  ffmpegPath: string,
  input: string,
  output: string,
  signal?: AbortSignal,
): Promise<void> {
  const args = ["-i", input, "-c", "copy", "-y", output]

  try {
    await execa(ffmpegPath, args, { cancelSignal: signal, stdio: ["ignore", "pipe", "pipe"] })
  } catch (err: unknown) {
    if (signal?.aborted) {
      throw new TikTokError("aborted", "Aborted by user")
    }
    const stderr = (err as { stderr?: string }).stderr ?? ""
    throw new TikTokError(
      "ffmpeg-error",
      `FFmpeg exited with code ${(err as { exitCode?: number }).exitCode}\n${stderr.slice(-500)}`,
    )
  }
}
