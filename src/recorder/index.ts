/**
 * Recorder orchestrator — wires together the API, monitor, stream downloader,
 * and converter into a single RecorderController.
 */

import { spawn } from "node:child_process"
import { createHttpClient } from "../api/client"
import { createTikTokApi, type TikTokApi } from "../api/tiktok"
import type { RecorderConfig, RecorderController } from "../config"
import { normalizeConfig, TikTokError } from "../config"
import { createLogger } from "../logger"
import { createPollingMonitor, type PollingMonitor } from "../monitor"
import { sleep } from "../utils"
import { type Converter, createConverter } from "./convert"
import { findFfmpegPath } from "./ffmpeg-utils"
import { type AudioNormalizer, createAudioNormalizer } from "./normalize"
import { processRecording } from "./post-processing"
import { createEventEmitter } from "./recorder-events"
import { createRecorderState } from "./recorder-state"
import type { DownloadResult } from "./stream"
import { createStreamDownloader, type StreamDownloader } from "./stream"

export function createRecorder(config: RecorderConfig): RecorderController {
  const cfg = normalizeConfig(config)
  const logger = createLogger({
    level: cfg.logLevel,
    logFile: "tiktok-recorder.log",
    console: cfg.logConsole,
  })

  const emitter = createEventEmitter()
  const stateManager = createRecorderState({ state: "idle" as const, user: cfg.user }, logger)

  // State variables
  let httpClient: Awaited<ReturnType<typeof createHttpClient>> | null = null
  let api: TikTokApi | null = null
  let monitor: PollingMonitor | null = null
  let downloader: StreamDownloader | null = null
  let converter: Converter | null = null
  let audioNormalizer: AudioNormalizer | null = null
  let stopRequested = false
  let stopAbortController = new AbortController()
  let pendingRemuxes: Promise<unknown>[] = []

  function getFfmpegPath(): string {
    const path = findFfmpegPath()
    if (!path) {
      throw new TikTokError(
        "ffmpeg-not-found",
        "FFmpeg not found. Install it:\n  Linux: apt install ffmpeg\n  macOS: brew install ffmpeg",
      )
    }
    return path
  }

  function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpegPath = getFfmpegPath()
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
          reject(new TikTokError("unknown", "Aborted by user"))
          return
        }
        if (code === 0) {
          resolve()
        } else {
          reject(
            new TikTokError("unknown", `FFmpeg exited with code ${code}\n${stderr.slice(-500)}`),
          )
        }
      })

      proc.on("error", (err) => {
        if (err instanceof Error && err.name === "AbortError") return
        reject(new TikTokError("unknown", `Failed to spawn FFmpeg: ${err.message}`))
      })
    })
  }

  async function start(): Promise<void> {
    if (stateManager.getStatus().state !== "idle") {
      logger.warn(`start() ignored: already in state ${stateManager.getStatus().state}`)
      return
    }
    stopRequested = false
    pendingRemuxes = []
    stopAbortController = new AbortController()

    logger.info(`Starting recorder for @${cfg.user}`)
    httpClient = await createHttpClient(cfg)
    api = createTikTokApi(httpClient, logger)
    downloader = createStreamDownloader(logger)
    converter = createConverter(logger, stopAbortController.signal)
    audioNormalizer = cfg.normalizeAudio
      ? createAudioNormalizer(
          {
            loudness: cfg.normalizeLoudness,
            audioCodec: cfg.normalizeCodec,
            audioBitrate: cfg.normalizeBitrate,
            onStart: (file) => emitter.emit("normalize:start", { file }),
            onProgress: (file, percent, phase) =>
              emitter.emit("normalize:progress", {
                file,
                percent,
                phase: phase as "analyzing" | "normalizing",
              }),
            onComplete: (result) =>
              emitter.emit("normalize:end", { input: result.input, output: result.output }),
            onError: (file, err) =>
              emitter.emit("normalize:error", { input: file, error: err.message }),
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

        emitter.emit("checking", { user })
        logger.info(`Checking @${user}...`)

        const roomId = await api!.getRoomId(user)
        if (!roomId) {
          logger.info(`@${user} is offline`)
          emitter.emit("tick", { user, isLive: false })
          return
        }

        const liveUrl = await api!.getLiveUrl(roomId)
        if (!liveUrl) {
          logger.warn(`@${user} is live but no stream URL found`)
          emitter.emit("tick", { user, isLive: false, roomId })
          return
        }

        logger.info(`@${user} is LIVE! (room: ${roomId})`)
        emitter.emit("tick", { user, isLive: true, roomId })

        stateManager.setState({ state: "recording" })
        emitter.emit("recording:start", { user, file: "" })

        const getNextUrl = async (): Promise<string | null> => {
          api!.invalidateCache()
          const stillLive = await api!.getRoomId(user)
          if (!stillLive) {
            logger.info(`@${user} is no longer live — stopping`)
            return null
          }
          return api!.getLiveUrl(stillLive)
        }

        const result = await downloader!.download(
          liveUrl,
          user,
          cfg.outputDir,
          cfg.duration,
          (info) => emitter.emit("download:progress", info),
          getNextUrl,
        )

        emitter.emit("download:end", {
          file: result.file,
          duration: result.duration,
          size: result.size,
        })

        await processRecording(result as DownloadResult, cfg, {
          runFfmpeg,
          converter: converter!,
          audioNormalizer,
          stopAbortController,
          pendingRemuxes,
          emit: (event: string, ...args: any[]) => (emitter as any).emit(event, ...args),
          setState: stateManager.setState,
          stopRequested: () => stopRequested,
          logger,
        })
      },
    })

    stateManager.setState({ state: "polling" })
    await monitor.start()
  }

  async function stop(): Promise<void> {
    if (stateManager.getStatus().state === "stopped") {
      logger.warn(`stop() ignored: already stopped`)
      return
    }
    stopRequested = true
    logger.info("Stopping recorder...")

    if (pendingRemuxes.length > 0) {
      logger.info(`Waiting for ${pendingRemuxes.length} pending conversion(s) (max 60s)...`)
      const abortTimeout = new AbortController()
      await Promise.race([
        Promise.allSettled(pendingRemuxes).finally(() => abortTimeout.abort()),
        sleep(60_000, abortTimeout.signal),
      ])
      pendingRemuxes = []
    }

    stopAbortController.abort()
    if (downloader) downloader.abort()
    if (monitor) await monitor.stop()
    if (httpClient) await httpClient.close()
    emitter.clear()
    stateManager.setState({ state: "stopped" })
    logger.info("Recorder stopped")
  }

  return {
    start,
    stop,
    getStatus: stateManager.getStatus,
    on: emitter.on,
    off: emitter.off,
  }
}
