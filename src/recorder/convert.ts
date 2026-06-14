/**
 * Converter — spawns FFmpeg to convert TS → MP4 (stream copy by default).
 * Deletes the original file on success.
 */

import { spawn } from "node:child_process"
import { unlinkSync } from "node:fs"
import { TikTokError } from "../config"
import type { Logger } from "../logger"
import { findFfmpegPath } from "../utils"

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

function runFfmpeg(
  ffmpegPath: string,
  input: string,
  output: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      input,
      "-c",
      "copy", // stream copy — no re-encode, fast
      "-y", // overwrite output
      output,
    ]

    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    })

    let stderr = ""

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 10000) stderr = stderr.slice(-5000)
    })

    proc.on("close", (code) => {
      if (signal?.aborted) {
        reject(new TikTokError("aborted", "Aborted by user"))
        return
      }
      if (code === 0) {
        resolve()
      } else {
        reject(
          new TikTokError("ffmpeg-error", `FFmpeg exited with code ${code}\n${stderr.slice(-500)}`),
        )
      }
    })

    proc.on("error", (err) => {
      if (err instanceof Error && err.name === "AbortError") return
      reject(new TikTokError("ffmpeg-error", `Failed to spawn FFmpeg: ${err.message}`))
    })
  })
}
