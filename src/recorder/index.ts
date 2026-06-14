/**
 * Recorder orchestrator — wires together the API, monitor, stream downloader,
 * and converter into a single RecorderController.
 *
 * Downloads the full stream (FLV via fetch, HLS via FFmpeg), then uses FFmpeg
 * to split it into time-aligned MP4 segments.
 */

import { spawn } from "node:child_process"
import { readdirSync, statSync, unlinkSync, utimesSync } from "node:fs"
import { join, parse } from "node:path"
import { createHttpClient } from "../api/client"
import { createTikTokApi, type TikTokApi } from "../api/tiktok"
import type {
  RecorderConfig,
  RecorderController,
  RecorderEvent,
  RecorderEventHandler,
  RecorderStatus,
} from "../config"
import { normalizeConfig, TikTokError } from "../config"
import { createLogger } from "../logger"
import { createPollingMonitor, type PollingMonitor } from "../monitor"
import { type Converter, createConverter } from "./convert"
import { type AudioNormalizer, createAudioNormalizer } from "./normalize"
import { createStreamDownloader, type StreamDownloader } from "./stream"

export function createRecorder(config: RecorderConfig): RecorderController {
  const cfg = normalizeConfig(config)
  const logger = createLogger({
    level: cfg.logLevel,
    logFile: "tiktok-recorder.log",
    console: cfg.logConsole,
  })

  // Internal event registry
  const eventHandlers = new Map<string, Array<(...args: any[]) => void>>()

  let state: RecorderStatus = {
    state: "idle",
    user: cfg.user,
  }

  // State machine
  let httpClient: Awaited<ReturnType<typeof createHttpClient>> | null = null
  let api: TikTokApi | null = null
  let monitor: PollingMonitor | null = null
  let downloader: StreamDownloader | null = null
  let converter: Converter | null = null
  let audioNormalizer: AudioNormalizer | null = null
  let stopRequested = false

  function setState(partial: Partial<RecorderStatus>): void {
    state = { ...state, ...partial }
  }

  function getStatus(): RecorderStatus {
    return { ...state }
  }

  function on<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void {
    const list = eventHandlers.get(event) ?? []
    list.push(handler as (...args: any[]) => void)
    eventHandlers.set(event, list)
  }

  function off<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void {
    const list = eventHandlers.get(event)
    if (!list) return
    const idx = list.indexOf(handler as (...args: any[]) => void)
    if (idx !== -1) list.splice(idx, 1)
  }

  function emit<E extends RecorderEvent>(
    event: E,
    ...args: Parameters<RecorderEventHandler[E]>
  ): void {
    const list = eventHandlers.get(event)
    if (list) {
      for (const h of list) {
        try {
          h(...args)
        } catch {
          // Never let an event handler crash the recorder
        }
      }
    }
  }

  function getFfmpegPath(): string {
    const bunWhich = (Bun as any)?.which
    if (typeof bunWhich === "function") {
      const path = bunWhich("ffmpeg") as string | undefined
      if (path) return path
    }
    throw new TikTokError(
      "ffmpeg-not-found",
      "FFmpeg not found. Install it:\n  Linux: apt install ffmpeg\n  macOS: brew install ffmpeg",
    )
  }

  function runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpegPath = getFfmpegPath()
      const proc = spawn(ffmpegPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      })

      let stderr = ""
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString()
        if (stderr.length > 10000) stderr = stderr.slice(-5000)
      })

      proc.on("close", (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(
            new TikTokError("unknown", `FFmpeg exited with code ${code}\n${stderr.slice(-500)}`),
          )
        }
      })

      proc.on("error", (err) => {
        reject(new TikTokError("unknown", `Failed to spawn FFmpeg: ${err.message}`))
      })
    })
  }

  async function start(): Promise<void> {
    stopRequested = false

    logger.info(`Starting recorder for @${cfg.user}`)
    httpClient = await createHttpClient(cfg)
    api = createTikTokApi(httpClient)
    downloader = createStreamDownloader(logger)
    converter = createConverter(logger)
    audioNormalizer = cfg.normalizeAudio
      ? createAudioNormalizer(
          {
            loudness: cfg.normalizeLoudness,
            audioCodec: cfg.normalizeCodec,
            audioBitrate: cfg.normalizeBitrate,
            onStart: (file) => emit("normalize:start", { file }),
            onProgress: (file, percent, phase) =>
              emit("normalize:progress", {
                file,
                percent,
                phase: phase as "analyzing" | "normalizing",
              }),
            onComplete: (result) =>
              emit("normalize:end", { input: result.input, output: result.output }),
            onError: (file, err) => emit("normalize:error", { input: file, error: err.message }),
          },
          logger,
        )
      : null

    monitor = createPollingMonitor({
      intervalMinutes: cfg.interval,
      logger,
      onTick: async () => {
        if (stopRequested) return

        const user = cfg.user
        api!.invalidateCache()

        emit("checking", { user })
        logger.info(`Checking @${user}...`)

        const roomId = await api!.getRoomId(user)
        if (!roomId) {
          logger.info(`@${user} is offline`)
          emit("tick", { user, isLive: false })
          return
        }

        const liveUrl = await api!.getLiveUrl(roomId)
        if (!liveUrl) {
          logger.warn(`@${user} is live but no stream URL found`)
          emit("tick", { user, isLive: false, roomId })
          return
        }

        logger.info(`@${user} is LIVE! (room: ${roomId})`)
        emit("tick", { user, isLive: true, roomId })

        // Record the stream
        setState({ state: "recording" })
        emit("recording:start", { user, file: "" })

        // Create a reconnection callback that fetches a fresh stream URL
        // when the current segment ends. This handles TikTok's short-lived
        // stream URLs (typically 30-60s per segment).
        let reconnectCount = 0
        const getNextUrl = async (): Promise<string | null> => {
          reconnectCount++
          if (reconnectCount > 100) {
            // Safety valve: don't reconnect indefinitely
            logger.warn(`Reconnection limit reached (${reconnectCount} attempts)`)
            return null
          }
          // Invalidate cache so we get fresh data from TikTok
          api!.invalidateCache()
          // Check if the user is still live with the same room
          const stillLive = await api!.getRoomId(user)
          if (!stillLive) {
            logger.info(`@${user} is no longer live — stopping`)
            return null
          }
          // Get a fresh stream URL for the continuing stream
          return api!.getLiveUrl(stillLive)
        }

        const result = await downloader!.download(
          liveUrl,
          user,
          cfg.outputDir,
          cfg.duration,
          (info) => emit("download:progress", info),
          getNextUrl,
        )

        emit("download:end", {
          file: result.file,
          duration: result.duration,
          size: result.size,
        })
        setState({ state: "converting" })

        if (result.size > 0 && cfg.segmentMinutes >= 1) {
          // Split the FLV into timed MP4 segments using FFmpeg
          const parsed = parse(result.file)
          const outputPattern = join(parsed.dir, `${parsed.name}_part%d.mp4`)
          const segmentTime = Math.max(1, cfg.segmentMinutes * 60)

          logger.info(
            `Segmenting: ${parsed.base} → ${parsed.name}_partN.mp4 (${cfg.segmentMinutes} min each)`,
          )

          emit("segmenting:start", { input: result.file, outputPattern })

          try {
            await runFfmpeg([
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
            ])

            // Capture FLV timestamp before deletion (used to timestamp segments)
            const flvMtimeMs = statSync(result.file).mtimeMs
            const recStartMs = flvMtimeMs - (result.duration ?? 0) * 1000

            // Delete the original FLV
            try {
              unlinkSync(result.file)
              logger.info(`Deleted original: ${parsed.base}`)
            } catch {
              logger?.warn(`Could not delete original: ${parsed.base}`)
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

            const segmentDurationSec = cfg.segmentMinutes * 60
            const totalDuration = result.duration

            for (let i = 0; i < segmentFiles.length; i++) {
              const filePath = join(parsed.dir, segmentFiles[i]!)
              const stats = statSync(filePath)
              // Estimate duration: first N-1 are full segments, last is remainder
              const isLast = i === segmentFiles.length - 1
              const estDuration = isLast
                ? Math.max(0, totalDuration - segmentDurationSec * (segmentFiles.length - 1))
                : segmentDurationSec

              emit("recording:end", {
                file: filePath,
                duration: estDuration,
                size: stats.size,
              })
              emit("converted", {
                input: result.file,
                output: filePath,
              })
            }

            // Set file modification times so segments sort chronologically
            for (let i = 0; i < segmentFiles.length; i++) {
              const fp = join(parsed.dir, segmentFiles[i]!)
              const segStart = recStartMs + i * segmentDurationSec * 1000
              utimesSync(fp, new Date(segStart), new Date(segStart))
            }

            emit("segmenting:end", { segments: segmentFiles.length })

            // Normalize audio for each segment if enabled
            if (audioNormalizer) {
              for (const segFile of segmentFiles) {
                const segPath = join(parsed.dir, segFile)
                try {
                  await audioNormalizer.normalize(segPath)
                } catch {
                  // Error already emitted via onError callback — continue to next segment
                }
              }
            }

            setState({
              currentFile:
                segmentFiles.length > 0 ? join(parsed.dir, segmentFiles.at(-1)!) : result.file,
              sessionDuration: result.duration,
            })
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            logger.error(`Segmenting failed: ${msg}`)
            // Fallback: try simple conversion of the whole FLV
            emit("converting:start", { input: result.file })
            try {
              const mp4File = await converter!.convert(result.file)
              emit("converted", { input: result.file, output: mp4File })
              if (audioNormalizer) {
                try {
                  await audioNormalizer.normalize(mp4File)
                } catch {
                  // Error already emitted via onError callback
                }
              }
            } catch (convErr) {
              const tkErr =
                convErr instanceof TikTokError
                  ? convErr
                  : new TikTokError("unknown", String(convErr))
              logger.error(`Conversion failed: ${tkErr.message}`)
              emit("error", tkErr)
            }
          }
        } else if (result.size > 0) {
          // No segmenting — simple FLV → MP4 conversion
          emit("converting:start", { input: result.file })
          try {
            const mp4File = await converter!.convert(result.file)
            if (audioNormalizer) {
              try {
                await audioNormalizer.normalize(mp4File)
              } catch {
                // Error already emitted via onError callback
              }
            }
            emit("recording:end", {
              file: mp4File,
              duration: result.duration,
              size: result.size,
            })
            emit("converted", { input: result.file, output: mp4File })
          } catch (convErr) {
            const tkErr =
              convErr instanceof TikTokError ? convErr : new TikTokError("unknown", String(convErr))
            logger.error(`Conversion failed: ${tkErr.message}`)
            emit("error", tkErr)
          }
        }

        setState({ state: "polling" })
      },
    })

    setState({ state: "polling" })
    await monitor.start()
  }

  async function stop(): Promise<void> {
    stopRequested = true
    logger.info("Stopping recorder...")
    if (downloader) downloader.abort()
    if (monitor) await monitor.stop()
    if (httpClient) await httpClient.close()
    setState({ state: "stopped" })
    logger.info("Recorder stopped")
  }

  return {
    start,
    stop,
    getStatus,
    on,
    off,
  }
}
