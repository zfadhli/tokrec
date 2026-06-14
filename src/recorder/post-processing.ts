/**
 * Post-recording processing — segmenting, conversion, and audio normalization.
 *
 * After a stream download completes, this module handles:
 * - Splitting the downloaded file into timed MP4 segments
 * - Converting FLV/TS to MP4 (fallback or direct)
 * - Audio normalization via EBU R128
 * - File management (deleting originals, setting timestamps)
 * - Event emissions for each step
 */

import { readdirSync, statSync, unlinkSync, utimesSync } from "node:fs"
import { join, parse } from "node:path"
import type { RecorderConfig } from "../config"
import { TikTokError } from "../config"
import type { Logger } from "../logger"
import type { Converter } from "./convert"
import type { AudioNormalizer } from "./normalize"
import type { DownloadResult } from "./stream"

export interface ProcessingDeps {
  runFfmpeg: (args: string[], signal?: AbortSignal) => Promise<void>
  converter: Converter
  audioNormalizer: AudioNormalizer | null
  stopAbortController: AbortController
  pendingRemuxes: Promise<unknown>[]
  emit: (event: string, ...args: any[]) => void
  setState: (partial: Record<string, unknown>) => void
  stopRequested: boolean
  logger: Logger
}

export async function processRecording(
  result: DownloadResult,
  cfg: RecorderConfig,
  deps: ProcessingDeps,
): Promise<void> {
  if (result.size === 0) return

  deps.setState({ state: "converting" })

  if (cfg.segmentMinutes && cfg.segmentMinutes >= 1) {
    await processSegmenting(result, cfg, deps)
  } else {
    await processConversion(result, cfg, deps)
  }

  deps.setState({ state: "polling" })
}

// ─── Segmenting path ──────────────────────────────────────────────

async function processSegmenting(
  result: DownloadResult,
  cfg: RecorderConfig,
  deps: ProcessingDeps,
): Promise<void> {
  const parsed = parse(result.file)
  const segmentTime = Math.max(1, (cfg.segmentMinutes ?? 20) * 60)
  const outputPattern = join(parsed.dir, `${parsed.name}_part%d.mp4`)

  deps.logger.info(
    `Segmenting: ${parsed.base} → ${parsed.name}_partN.mp4 (${cfg.segmentMinutes ?? 20} min each)`,
  )
  deps.emit("segmenting:start", { input: result.file, outputPattern })

  try {
    const segmentPromise = deps.runFfmpeg(
      [
        "-i",
        result.file,
        "-c",
        "copy",
        "-f",
        "segment",
        "-segment_time",
        String(segmentTime),
        "-reset_timestamps",
        "1",
        "-segment_start_number",
        "1",
        outputPattern,
      ],
      deps.stopAbortController.signal,
    )
    deps.pendingRemuxes.push(segmentPromise)
    await segmentPromise

    // Capture FLV timestamp before deletion
    const flvMtimeMs = statSync(result.file).mtimeMs
    const recStartMs = flvMtimeMs - (result.duration ?? 0) * 1000

    // Delete the original FLV
    try {
      unlinkSync(result.file)
      deps.logger.info(`Deleted original: ${parsed.base}`)
    } catch {
      deps.logger.warn(`Could not delete original: ${parsed.base}`)
    }

    // Find generated segment files
    const allFiles = readdirSync(parsed.dir)
    const prefix = `${parsed.name}_part`
    const segmentFiles = allFiles
      .filter((f) => f.startsWith(prefix) && f.endsWith(".mp4"))
      .sort((a, b) => {
        const na = Number.parseInt(a.match(/_part(\d+)\.mp4$/)?.[1] ?? "0", 10)
        const nb = Number.parseInt(b.match(/_part(\d+)\.mp4$/)?.[1] ?? "0", 10)
        return na - nb
      })

    const segmentDurationSec = segmentTime
    const totalDuration = result.duration

    // Emit events for each segment
    for (let i = 0; i < segmentFiles.length; i++) {
      const filePath = join(parsed.dir, segmentFiles[i]!)
      const stats = statSync(filePath)
      const isLast = i === segmentFiles.length - 1
      const estDuration = isLast
        ? Math.max(0, totalDuration - segmentDurationSec * (segmentFiles.length - 1))
        : segmentDurationSec

      deps.emit("recording:end", { file: filePath, duration: estDuration, size: stats.size })
      deps.emit("converted", { input: result.file, output: filePath })
    }

    // Set file modification times so segments sort chronologically
    for (let i = 0; i < segmentFiles.length; i++) {
      const fp = join(parsed.dir, segmentFiles[i]!)
      const segStart = recStartMs + i * segmentDurationSec * 1000
      utimesSync(fp, new Date(segStart), new Date(segStart))
    }

    deps.emit("segmenting:end", { segments: segmentFiles.length })

    // Normalize audio for each segment if enabled
    if (deps.audioNormalizer) {
      const normalizer = deps.audioNormalizer
      const normalizePromises = segmentFiles.map(async (segFile) => {
        const segPath = join(parsed.dir, segFile)
        try {
          await normalizer.normalize(segPath)
        } catch {
          // Error already emitted via onError callback
        }
      })
      deps.pendingRemuxes.push(...normalizePromises)
      await Promise.allSettled(normalizePromises)
    }

    deps.setState({
      currentFile: segmentFiles.length > 0 ? join(parsed.dir, segmentFiles.at(-1)!) : result.file,
      sessionDuration: result.duration,
    })
  } catch (err) {
    if (deps.stopRequested) return
    const msg = err instanceof Error ? err.message : String(err)
    deps.logger.error(`Segmenting failed: ${msg}`)
    deps.setState({ lastError: `Segmenting failed: ${msg}` })
    // Fallback: try simple conversion of the whole FLV
    await runFallbackConversion(result, deps)
  }
}

// ─── Conversion path (no segmenting) ─────────────────────────────

async function processConversion(
  result: DownloadResult,
  _cfg: RecorderConfig,
  deps: ProcessingDeps,
): Promise<void> {
  deps.emit("converting:start", { input: result.file })
  try {
    const convertPromise = deps.converter.convert(result.file)
    deps.pendingRemuxes.push(convertPromise)
    const mp4File = await convertPromise

    if (deps.audioNormalizer) {
      const normalizePromise = deps.audioNormalizer.normalize(mp4File).catch(() => {})
      deps.pendingRemuxes.push(normalizePromise)
      await normalizePromise
    }

    deps.emit("recording:end", { file: mp4File, duration: result.duration, size: result.size })
    deps.emit("converted", { input: result.file, output: mp4File })
  } catch (convErr) {
    const tkErr =
      convErr instanceof TikTokError ? convErr : new TikTokError("unknown", String(convErr))
    deps.logger.error(`Conversion failed: ${tkErr.message}`)
    deps.setState({ lastError: `Conversion failed: ${tkErr.message}` })
    deps.emit("error", tkErr)
  }
}

// ─── Fallback conversion (when segmenting fails) ─────────────────

async function runFallbackConversion(result: DownloadResult, deps: ProcessingDeps): Promise<void> {
  deps.emit("converting:start", { input: result.file })
  try {
    const convertPromise = deps.converter.convert(result.file)
    deps.pendingRemuxes.push(convertPromise)
    const mp4File = await convertPromise
    deps.emit("converted", { input: result.file, output: mp4File })

    if (deps.audioNormalizer) {
      const normalizePromise = deps.audioNormalizer.normalize(mp4File).catch(() => {})
      deps.pendingRemuxes.push(normalizePromise)
      await normalizePromise
    }
  } catch (convErr) {
    const tkErr =
      convErr instanceof TikTokError ? convErr : new TikTokError("unknown", String(convErr))
    deps.logger.error(`Conversion failed: ${tkErr.message}`)
    deps.setState({ lastError: `Conversion failed: ${tkErr.message}` })
    deps.emit("error", tkErr)
  }
}
