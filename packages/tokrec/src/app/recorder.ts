/**
 * Recorder orchestrator — wires the TikTok client, stream download, and
 * RecordingJob into a single RecorderController.
 *
 * Policy lives in `policy/tick.ts`; this file maps a TickPlan to effects and
 * owns the session state those effects mutate. Everything a tick needs is
 * constructed as a `const` in `start()` and passed in, so no call site has to
 * assert a non-null module-level `let` back into existence.
 */

import { planTick, type TickFacts } from "../core/plan"
import { verdictOf } from "../core/verdict"
import { createHttpClient, type HttpClient } from "../io/http"
import { type Converter, createConverter } from "../io/media/convert"
import { downloadStream } from "../io/media/download"
import { type AudioNormalizer, createAudioNormalizer } from "../io/media/normalize"
import { createTikTokClient, type TikTokClient } from "../io/tiktok/client"
import { type AbortScope, abortScope } from "./abort"
import type { RecorderConfig, RecorderController, RecorderStatus } from "./config"
import { normalizeConfig } from "./config"
import { createEventEmitter } from "./events"
import { createRecordingJob, type RecordingJob } from "./job"
import { createLogger } from "./logger"
import { createPollingMonitor, type PollingMonitor } from "./loop"

/** Max wait for a stop-time remux before aborting it (matches the pre-#32 cap). */
const POST_REMUX_GRACE_MS = 10 * 60 * 1000

/** Everything one poll tick needs, built by `start()` before the tick can run. */
interface TickDeps {
  client: TikTokClient
  monitor: PollingMonitor
  scope: AbortScope
  post: AbortScope
  converter: Converter
  audioNormalizer: AudioNormalizer | null
}

/** What `stop()` has to join and release. */
interface Running {
  monitor: PollingMonitor
  http: HttpClient
  scope: AbortScope
}

export function createRecorder(config: RecorderConfig): RecorderController {
  const cfg = normalizeConfig(config)
  const logger = createLogger({
    level: cfg.logLevel,
    logFile: "tiktok-recorder.log",
    console: cfg.logConsole,
  })

  const emitter = createEventEmitter()

  // Session state — written by ticks and by the job lifecycle, read by getStatus().
  const status: RecorderStatus = { state: "idle", user: cfg.user }
  let running: Running | null = null
  let postScope: AbortScope | null = null
  let currentJob: RecordingJob | null = null
  let recordedSec = 0
  let consecutiveErrors = 0

  function setState(partial: Partial<RecorderStatus>): void {
    const prev = status.state
    Object.assign(status, partial)
    if (partial.state !== undefined && partial.state !== prev) {
      logger.info(`State: ${prev} → ${partial.state}`)
      if (partial.state === "polling") status.lastPollTime = new Date().toISOString()
    }
  }

  async function tick(d: TickDeps): Promise<void> {
    const { client, monitor, scope, post } = d
    if (scope.signal.aborted) return
    const user = cfg.user

    client.invalidateCache()
    logger.info(`Checking @${user}...`)

    const verdict = await client.getVerdict(user)
    const facts: TickFacts = {
      recording: currentJob !== null,
      recordedSec,
      oneShot: cfg.duration > 0,
      consecutiveErrors,
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
          monitor.stopAfterCurrentTick()
        } else if (plan.why === "gave-up") {
          logger.error(`@${user} gave up after ${consecutiveErrors} consecutive errors`)
          monitor.stopAfterCurrentTick()
        }
        return
      }
      case "record": {
        const { room, stream } = plan
        logger.info(`@${user} is LIVE! (room: ${room.id}, reason: live)`)
        setState({ state: "recording" })
        emitter.emit("record", { phase: "start", user, file: "" })

        const getNextUrl = async (): Promise<string | null> => {
          if (scope.signal.aborted) return null
          // Use the lightweight check_alive endpoint first — avoids a full
          // page re-scan + room/info call when the stream is still active.
          const alive = await client.isRoomAlive(room.id)
          if (!alive) {
            logger.info(`@${user} is no longer live — stopping`)
            return null
          }
          client.invalidateCache()
          return client.getLiveUrl(room.id)
        }

        const result = await downloadStream(
          stream.url,
          user,
          cfg.outputDir,
          cfg.duration,
          (info) => emitter.emit("progress", { kind: "download", ...info }),
          getNextUrl,
          scope.signal,
          logger,
          cfg.cookies,
        )

        emitter.emit("record", { phase: "download", ...result })
        recordedSec += result.duration

        const job = createRecordingJob({
          result,
          cfg: { segmentMinutes: cfg.segmentMinutes },
          logger,
          converter: d.converter,
          audioNormalizer: d.audioNormalizer,
          signal: post.signal,
          emitRecord: (event) => emitter.emit("record", event),
          emitProgress: (event) => emitter.emit("progress", event),
          emitFailure: (err) => emitter.emit("failure", err),
          setState,
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
          monitor.stopAfterCurrentTick()
        } else if (!scope.signal.aborted) {
          // Recording ended because the stream went offline (not user-initiated
          // stop). Immediately re-check via the lightweight endpoint.
          const alive = await client.isRoomAlive(room.id)
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
  }

  async function start(): Promise<void> {
    if (status.state !== "idle") {
      logger.warn(`start() ignored: already in state ${status.state}`)
      return
    }
    const scope = abortScope()
    // Post-processing outlives a user stop: Ctrl+C aborts the download, but the
    // partial .ts is still remuxed to .mp4 before the process exits.
    const post = abortScope()
    postScope = post
    currentJob = null
    recordedSec = 0
    consecutiveErrors = 0

    logger.info(`Starting recorder for @${cfg.user}`)
    const http = await createHttpClient(cfg)
    const client = createTikTokClient(http, logger, cfg.debug, scope.signal)
    const converter = createConverter(logger, post.signal)
    const audioNormalizer = cfg.normalizeAudio
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

    // Self-reference inside `onTick` is safe: the monitor calls it from
    // `start()`, never during construction.
    let monitor: PollingMonitor
    monitor = createPollingMonitor({
      intervalMinutes: cfg.interval,
      signal: scope.signal,
      logger,
      onTick: () => tick({ client, monitor, scope, post, converter, audioNormalizer }),
    })
    running = { monitor, http, scope }

    setState({ state: "polling" })
    await monitor.start()
  }

  async function stop(): Promise<void> {
    if (status.state === "stopped") {
      logger.warn(`stop() ignored: already stopped`)
      return
    }
    logger.info("Stopping recorder...")
    running?.scope.close("user")

    const grace = setTimeout(() => postScope?.close("stop-timeout"), POST_REMUX_GRACE_MS)
    try {
      const job = currentJob
      if (job) {
        logger.info("Waiting for active recording to finish...")
        await job.finish()
      }

      if (running) await running.monitor.stop()
    } finally {
      clearTimeout(grace)
    }
    if (running) await running.http.close()
    emitter.clear()
    setState({ state: "stopped" })
    logger.info("Recorder stopped")
  }

  return {
    start,
    stop,
    getStatus: () => ({ ...status }),
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
