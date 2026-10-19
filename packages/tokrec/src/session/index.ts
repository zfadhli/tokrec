/**
 * Recorder orchestrator — wires together the API, monitor, stream downloader,
 * and RecordingJob into a single RecorderController.
 *
 * Policy lives in `policy/tick.ts`; this file only maps a TickPlan to effects.
 */

import { execa } from "execa"
import { createHttpClient } from "../adapters/http/wreq"
import { type Converter, createConverter } from "../adapters/media/convert"
import { type AudioNormalizer, createAudioNormalizer } from "../adapters/media/normalize"
import { verdictOf } from "../domain/verdict"
import type { RecorderConfig, RecorderController } from "../lib/config"
import { normalizeConfig, TikTokError } from "../lib/config"
import { createLogger } from "../lib/logger"
import { findFfmpegPath } from "../lib/utils"
import { planTick, type TickFacts } from "../policy/tick"
import { type AbortScope, abortScope } from "./abort"
import { createRecordingJob, type RecordingJob } from "./job"
import { createPollingMonitor, type PollingMonitor } from "./loop"
import { createTikTokApi, type TikTokApi } from "./probe"
import { createEventEmitter } from "./recorder-events"
import { createRecorderState } from "./recorder-state"
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
  let scope: AbortScope | null = null
  let currentJob: RecordingJob | null = null
  let recordedSec = 0
  let consecutiveErrors = 0

  async function runFfmpeg(args: string[], signal?: AbortSignal): Promise<string> {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      throw new TikTokError(
        "ffmpeg-not-found",
        "FFmpeg not found. Install it:\n  Linux: apt install ffmpeg\n  macOS: brew install ffmpeg",
      )
    }
    try {
      const result = await execa(ffmpegPath, args, {
        cancelSignal: signal,
        stdio: ["ignore", "pipe", "pipe"],
      })
      return result.stdout ?? ""
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new TikTokError("aborted", "Aborted by user")
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new TikTokError("ffmpeg-error", `FFmpeg failed: ${message}`)
    }
  }

  async function start(): Promise<void> {
    if (stateManager.getStatus().state !== "idle") {
      logger.warn(`start() ignored: already in state ${stateManager.getStatus().state}`)
      return
    }
    const activeScope = abortScope()
    scope = activeScope
    currentJob = null
    recordedSec = 0
    consecutiveErrors = 0

    logger.info(`Starting recorder for @${cfg.user}`)
    httpClient = await createHttpClient(cfg)
    api = createTikTokApi(httpClient, logger, cfg.debug, activeScope.signal)
    downloader = createStreamDownloader(logger)
    converter = createConverter(logger, activeScope.signal)
    audioNormalizer = cfg.normalizeAudio
      ? createAudioNormalizer(
          {
            loudness: cfg.normalizeLoudness,
            audioCodec: cfg.normalizeCodec,
            audioBitrate: cfg.normalizeBitrate,
            onProgress: (file, percent, phase) =>
              emitter.emit("progress", {
                kind: "normalize",
                file,
                percent,
                phase: phase as "analyzing" | "normalizing",
              }),
          },
          logger,
        )
      : null

    monitor = createPollingMonitor({
      intervalMinutes: cfg.interval,
      signal: activeScope.signal,
      logger,
      onTick: async () => {
        if (activeScope.signal.aborted) return

        // All dependencies are initialized by start() before onTick runs
        const tikTokApi = api as TikTokApi
        const streamDownloader = downloader as StreamDownloader
        const pollingMonitor = monitor as PollingMonitor
        const user = cfg.user

        tikTokApi.invalidateCache()
        logger.info(`Checking @${user}...`)

        const verdict = await tikTokApi.getVerdict(user)
        const facts: TickFacts = {
          recording: currentJob !== null,
          recordedSec,
          oneShot: cfg.duration > 0,
          consecutiveErrors,
          stopRequested: activeScope.signal.aborted,
        }
        consecutiveErrors =
          verdict.reason === "error" || verdict.reason === "no-room-id" ? consecutiveErrors + 1 : 0

        emitter.emit("verdict", verdict)
        const plan = planTick(verdict, facts)

        switch (plan.kind) {
          case "poll": {
            logger.info(
              `@${user} ${plan.note} (reason: ${verdict.reason}, source: ${lastSource(verdict)})`,
            )
            return
          }
          case "hold": {
            if (plan.reason === "restricted") {
              logger.warn(
                `@${user} is live but age-protected/restricted — stream unavailable (reason: restricted, status_code 4003110, room: ${plan.room.id})`,
              )
            } else {
              logger.warn(
                `@${user} is live but no stream URL found (reason: no-stream-url, room: ${plan.room.id})`,
              )
            }
            return
          }
          case "stop": {
            if (plan.why === "one-shot") {
              logger.info("Duration limit reached — exiting")
              pollingMonitor.stopAfterCurrentTick()
            } else if (plan.why === "gave-up") {
              logger.error(`@${user} gave up after ${consecutiveErrors} consecutive errors`)
              pollingMonitor.stopAfterCurrentTick()
            }
            return
          }
          case "record": {
            const { room, stream } = plan
            logger.info(`@${user} is LIVE! (room: ${room.id}, reason: live)`)
            stateManager.setState({ state: "recording" })
            emitter.emit("record", { phase: "start", user, file: "" })

            const getNextUrl = async (): Promise<string | null> => {
              if (activeScope.signal.aborted) return null
              // Use the lightweight check_alive endpoint first — avoids a full
              // page re-scan + room/info call when the stream is still active.
              const alive = await tikTokApi.isRoomAlive(room.id)
              if (!alive) {
                logger.info(`@${user} is no longer live — stopping`)
                return null
              }
              tikTokApi.invalidateCache()
              return tikTokApi.getLiveUrl(room.id)
            }

            const result = await streamDownloader.download(
              stream.url,
              user,
              cfg.outputDir,
              cfg.duration,
              (info) => emitter.emit("progress", { kind: "download", ...info }),
              getNextUrl,
              cfg.cookies,
              activeScope.signal,
            )

            emitter.emit("record", { phase: "download", ...result })
            recordedSec += result.duration
            if (activeScope.signal.aborted) return

            const job = createRecordingJob({
              result,
              cfg: { segmentMinutes: cfg.segmentMinutes },
              logger,
              runFfmpeg,
              converter: converter as Converter,
              audioNormalizer,
              signal: activeScope.signal,
              emitRecord: (event) => emitter.emit("record", event),
              emitProgress: (event) => emitter.emit("progress", event),
              emitFailure: (err) => emitter.emit("failure", err),
              setState: stateManager.setState,
            })
            currentJob = job
            try {
              await job.finish()
            } finally {
              currentJob = null
            }

            // One-shot mode: if a duration was set, stop after this recording
            if (cfg.duration > 0) {
              logger.info("Duration limit reached — exiting")
              pollingMonitor.stopAfterCurrentTick()
            } else if (!activeScope.signal.aborted) {
              // Recording ended because the stream went offline (not user-initiated
              // stop). Immediately re-check via the lightweight endpoint.
              const alive = await tikTokApi.isRoomAlive(room.id)
              if (!alive) {
                logger.info(`@${user} is offline`)
                emitter.emit(
                  "verdict",
                  verdictOf({ room: { ...room, live: false }, evidence: verdict.evidence }),
                )
              }
            }
            return
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
    logger.info("Stopping recorder...")
    scope?.close("user")

    const job = currentJob
    if (job) {
      logger.info("Waiting for active recording to finish...")
      await job.finish()
    }

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

function lastSource(verdict: ReturnType<typeof verdictOf>): string {
  return (
    [...verdict.evidence].reverse().find((e) => e.outcome === "hit" || e.outcome === "denied")
      ?.source ?? "none"
  )
}
