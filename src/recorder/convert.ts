/**
 * Converter — spawns FFmpeg to convert FLV/TS → MP4 (stream copy by default).
 * Deletes the original file on success.
 */

import { spawn } from "node:child_process"
import { statSync, unlinkSync } from "node:fs"
import type { Logger } from "../logger"

export interface Converter {
  /** Convert a FLV or TS file to MP4. Returns the output filepath. */
  convert: (input: string) => Promise<string>
}

export function createConverter(logger?: Logger, signal?: AbortSignal): Converter {
  async function convert(input: string): Promise<string> {
    const output = input.replace(/\.(flv|ts)$/i, ".mp4")

    logger?.info(`Converting: ${input} → ${output}`)

    const ffmpegPath = findFfmpeg()
    if (!ffmpegPath) {
      throw new Error(
        "FFmpeg not found. Install it:\n" +
          "  Linux:  apt install ffmpeg / brew install ffmpeg / pacman -S ffmpeg\n" +
          "  macOS:  brew install ffmpeg\n" +
          "  Windows: choco install ffmpeg",
      )
    }

    await runFfmpeg(ffmpegPath, input, output, signal)

    // Delete original FLV
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

function findFfmpeg(): string | null {
  // Bun.which searches PATH like `which`
  const bunWhich = (Bun as any)?.which
  if (typeof bunWhich === "function") {
    return bunWhich("ffmpeg") as string | null
  }

  // Fallback: manual PATH search
  const paths = process.env.PATH?.split(":") ?? []
  for (const dir of paths) {
    try {
      const full = `${dir}/ffmpeg`
      statSync(full)
      return full
    } catch {
      // eslint-disable-line no-empty
    }
  }
  return null
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
        reject(new Error("Aborted by user"))
        return
      }
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`FFmpeg exited with code ${code}\n${stderr.slice(-500)}`))
      }
    })

    proc.on("error", (err) => {
      if (err instanceof Error && err.name === "AbortError") return
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`))
    })
  })
}
