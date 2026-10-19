/**
 * RecordingJob — owns one download's post-processing and the promises it
 * spawns. `finish()` is idempotent so `stop()` can join without the recorder
 * reaching into a shared array.
 */

import { statSync, unlinkSync, utimesSync } from "node:fs"
import { join, parse } from "node:path"
import type { Converter } from "../adapters/media/convert"
import type { AudioNormalizer } from "../adapters/media/normalize"
import type {
  ProgressEvent,
  RecordEvent,
  RecordedFile,
  RecorderConfig,
  RecorderStatus,
} from "../lib/config"
import { TikTokError } from "../lib/config"
import type { Logger } from "../lib/logger"

export interface RecordingJob {
  readonly file: string
  finish(): Promise<RecordedFile[]>
}

export interface RecordingJobDeps {
  result: RecordedFile
  cfg: Pick<RecorderConfig, "segmentMinutes">
  logger: Logger
  converter: Converter
  audioNormalizer: AudioNormalizer | null
  signal: AbortSignal
  emitRecord: (event: RecordEvent) => void
  emitProgress: (event: ProgressEvent) => void
  emitFailure: (err: TikTokError) => void
  setState: (partial: Partial<RecorderStatus>) => void
}

export function createRecordingJob(deps: RecordingJobDeps): RecordingJob {
  let promise: Promise<RecordedFile[]> | null = null

  return {
    file: deps.result.file,
    finish(): Promise<RecordedFile[]> {
      promise ??= run(deps)
      return promise
    },
  }
}

async function run(deps: RecordingJobDeps): Promise<RecordedFile[]> {
  const { result, cfg, logger, signal } = deps
  try {
    if (statSync(result.file).size === 0) return []
  } catch {
    return []
  }

  try {
    if (cfg.segmentMinutes && cfg.segmentMinutes >= 1) return await segment(deps)
    return await convert(deps)
  } catch (err) {
    if (!signal.aborted) {
      const tkErr = err instanceof TikTokError ? err : new TikTokError("unknown", String(err))
      logger.error(`Recording processing failed: ${tkErr.message}`)
      deps.setState({ lastError: tkErr.message })
      deps.emitFailure(tkErr)
    }
    return []
  } finally {
    if (!signal.aborted) deps.setState({ state: "polling" })
  }
}

async function segment(deps: RecordingJobDeps): Promise<RecordedFile[]> {
  const { result, cfg, logger, signal } = deps
  const parsed = parse(result.file)
  const segmentTime = Math.max(1, (cfg.segmentMinutes ?? 20) * 60)
  const outputPattern = join(parsed.dir, `${parsed.name}_part%d.mp4`)

  logger.info(
    `Segmenting: ${parsed.base} → ${parsed.name}_partN.mp4 (${cfg.segmentMinutes ?? 20} min each)`,
  )
  deps.setState({ state: "segmenting" })
  deps.emitRecord({
    phase: "segment",
    status: "start",
    input: result.file,
    outputPattern,
  })

  let listing: string
  try {
    listing = await deps.converter.segment(result.file, segmentTime, outputPattern)
  } catch (err) {
    if (signal.aborted) return []
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`Segmenting failed: ${msg}`)
    deps.setState({ lastError: `Segmenting failed: ${msg}` })
    return convert(deps)
  }

  const segments = parseSegmentList(listing, segmentTime)
  if (segments.length === 0) {
    logger.warn("Segmenting produced no files — falling back to whole-file conversion")
    return convert(deps)
  }

  const fileMtimeMs = statSync(result.file).mtimeMs
  const recStartMs = fileMtimeMs - result.duration * 1000

  try {
    unlinkSync(result.file)
    logger.info(`Deleted original: ${parsed.base}`)
  } catch {
    logger.warn(`Could not delete original: ${parsed.base}`)
  }

  const files: RecordedFile[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg) continue
    const stats = statSync(seg.file)
    const recorded: RecordedFile = {
      file: seg.file,
      duration: seg.duration,
      size: stats.size,
    }
    files.push(recorded)
    deps.emitRecord({ phase: "end", ...recorded })
    deps.emitRecord({
      phase: "convert",
      status: "done",
      input: result.file,
      output: seg.file,
    })

    const segStart = recStartMs + i * segmentTime * 1000
    utimesSync(seg.file, new Date(segStart), new Date(segStart))
  }

  deps.emitRecord({ phase: "segment", status: "end", segments: files.length })

  if (deps.audioNormalizer) {
    for (const recorded of files) {
      await normalize(deps, recorded.file)
    }
  }

  deps.setState({
    currentFile: files.at(-1)?.file ?? result.file,
    sessionDuration: result.duration,
  })
  return files
}

async function convert(deps: RecordingJobDeps): Promise<RecordedFile[]> {
  const { result, logger, signal } = deps
  deps.setState({ state: "converting" })
  deps.emitRecord({ phase: "convert", status: "start", input: result.file })

  let mp4File: string
  try {
    mp4File = await deps.converter.convert(result.file)
  } catch (err) {
    if (signal.aborted) return []
    throw err
  }

  const recorded: RecordedFile = {
    file: mp4File,
    duration: result.duration,
    size: result.size,
  }
  deps.emitRecord({ phase: "end", ...recorded })

  if (deps.audioNormalizer) await normalize(deps, mp4File)

  deps.emitRecord({
    phase: "convert",
    status: "done",
    input: result.file,
    output: mp4File,
  })
  logger.info(`Converted: ${mp4File}`)
  deps.setState({ currentFile: mp4File, sessionDuration: result.duration })
  return [recorded]
}

async function normalize(deps: RecordingJobDeps, file: string): Promise<void> {
  if (!deps.audioNormalizer) return
  deps.emitRecord({ phase: "normalize", status: "start", file })
  try {
    const result = await deps.audioNormalizer.normalize(file)
    deps.emitRecord({
      phase: "normalize",
      status: "done",
      input: file,
      output: result.output,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.emitRecord({
      phase: "normalize",
      status: "error",
      input: file,
      error: message,
    })
  }
}

function parseSegmentList(
  listing: string,
  fallbackDuration: number,
): { file: string; duration: number }[] {
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const [file, start, end] = line.split(",").map((field) => field.replace(/^"|"$/g, ""))
      if (!file) return []
      const duration = Number(end) - Number(start)
      return [
        { file, duration: Number.isFinite(duration) && duration > 0 ? duration : fallbackDuration },
      ]
    })
}
