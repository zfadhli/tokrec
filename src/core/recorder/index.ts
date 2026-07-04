/**
 * Recorder orchestrator — wires together the API, monitor, stream downloader,
 * and converter into a single RecorderController.
 */

import { execa } from "execa"
import type { RecorderConfig, RecorderController } from "../../lib/config"
import { normalizeConfig, TikTokError } from "../../lib/config"
import { createLogger } from "../../lib/logger"
import { findFfmpegPath, sleep } from "../../lib/utils"
import { createHttpClient } from "../api/client"
import { createTikTokApi, type TikTokApi } from "../api/tiktok"
import { createPollingMonitor, type PollingMonitor } from "../monitor"
import { type Converter, createConverter } from "./convert"
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

  async function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      throw new TikTokError(
        "ffmpeg-not-found",
        "FFmpeg not found. Install it:\n  Linux: apt install ffmpeg\n  macOS: brew install ffmpeg",
      )
    }
    try {
      await execa(ffmpegPath, args, { signal, stdio: ["ignore", "pipe", "pipe"] })
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new TikTokError("unknown", "Aborted by user")
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new TikTokError("unknown", `FFmpeg failed: ${message}`)
    }
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
    api = createTikTokApi(httpClient, logger, cfg.debug)
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

        // All dependencies are initialized by start() before onTick runs
        const tikTokApi = api as TikTokApi
        const streamDownloader = downloader as StreamDownloader
        const pollingMonitor = monitor as PollingMonitor

        const user = cfg.user
        tikTokApi.invalidateCache()

        emitter.emit("checking", { user })
        logger.info(`Checking @${user}...`)

        const roomId = await tikTokApi.getRoomId(user)
        if (!roomId) {
          logger.info(`@${user} is offline`)
          emitter.emit("tick", { user, isLive: false })
          return
        }

        const liveUrl = await tikTokApi.getLiveUrl(roomId)
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
          // Use the lightweight check_alive endpoint first — avoids a full
          // page re-scan + room/info call when the stream is still active.
          const alive = await tikTokApi.isRoomAlive(roomId)
          if (!alive) {
            logger.info(`@${user} is no longer live — stopping`)
            return null
          }
          // Still alive — invalidate cache and get a fresh stream URL.
          tikTokApi.invalidateCache()
          return tikTokApi.getLiveUrl(roomId)
        }

        const result = await streamDownloader.download(
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
          converter: converter as Converter,
          audioNormalizer,
          stopAbortController,
          pendingRemuxes,
          emit: (emitter.emit as (event: string, ...args: unknown[]) => void).bind(emitter),
          setState: stateManager.setState,
          stopRequested: () => stopRequested,
          logger,
        })

        // One-shot mode: if a duration was set, stop after this recording
        if (cfg.duration > 0) {
          logger.info("Duration limit reached — exiting")
          pollingMonitor.stopAfterCurrentTick()
        } else if (!stopRequested && roomId) {
          // Recording ended because the stream went offline (not user-initiated stop).
          // Immediately re-check via lightweight check_alive endpoint instead of
          // waiting for the next poll interval.
          const alive = await tikTokApi.isRoomAlive(roomId)
          if (!alive) {
            logger.info(`@${user} is offline`)
            emitter.emit("tick", { user, isLive: false })
          }
        }
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

    if (downloader) downloader.abort()
    if (monitor) await monitor.stop()
    stopAbortController.abort()
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
