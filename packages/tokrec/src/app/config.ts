/**
 * Config — types, defaults, and normalization for the recorder.
 * The single source of truth for every user-facing option.
 */

import { TikTokError } from "../core/errors"
import type { Verdict } from "../core/verdict"

/**
 * TikTok cookie key-value pairs extracted from Firefox or cookies.json.
 * Includes session cookies (sessionid_ss, tt-target-idc) and any WAF
 * bypass cookies needed to avoid Slardar challenges on www.tiktok.com.
 */
export type CookieAuth = Record<string, string>

export type LogLevel = "debug" | "info" | "warn" | "error"

/**
 * Machine-readable reason for a LIVE status verdict — lives in `domain/verdict.ts`.
 */
export type { LiveReason } from "../core/verdict"

export interface RecorderConfig {
  /** TikTok username (required) */
  user: string
  /** Output directory for recordings (default: ./recordings) */
  outputDir?: string
  /** Polling interval in minutes (default: 3) */
  interval?: number
  /** Max recording duration in seconds (default: 0 — unlimited). CLI accepts minutes, converted internally. */
  duration?: number
  /** HTTP proxy URL (e.g. http://127.0.0.1:8080) */
  proxy?: string
  /** Path to cookies.json (default: ./cookies.json) */
  cookiesPath?: string
  /** Cookie auth loaded from cookies.json */
  cookies?: CookieAuth
  /** Log level (default: info) */
  logLevel?: LogLevel
  /** Whether to print logs to console (default: true). Set false when using Display-based UI. */
  logConsole?: boolean
  /** Segment duration in minutes (default: 0 — disabled). When >= 1, the recording is split into segments of this length. */
  segmentMinutes?: number
  /** Normalize audio loudness via EBU R128 (default: false). */
  normalizeAudio?: boolean
  /** Target loudness in LUFS (default: -14). */
  normalizeLoudness?: number
  /** Audio codec for normalized output (default: peaknorm's default, "libopus"). */
  normalizeCodec?: string
  /** Audio bitrate for normalized output (default: peaknorm's default, "96k"). */
  normalizeBitrate?: string
  /**
   * Max API requests per second (default: 5).
   * Prevents TikTok WAF triggering on rapid polling or URL refresh loops.
   * Set to 0 for unlimited (not recommended).
   */
  ratePerSecond?: number
  /** Show API debug logging on stderr (default: false). */
  debug?: boolean
}

export interface RecorderController {
  /** Start the polling loop */
  start(): Promise<void>
  /** Gracefully stop (joins active recording, then exits) */
  stop(): Promise<void>
  /** Snapshot of current state */
  getStatus(): RecorderStatus
  /** Subscribe to events */
  on<E extends keyof RecorderEventHandler>(event: E, handler: RecorderEventHandler[E]): void
  /** Unsubscribe a previously registered event handler */
  off<E extends keyof RecorderEventHandler>(event: E, handler: RecorderEventHandler[E]): void
}

export type Phase = "idle" | "polling" | "recording" | "segmenting" | "converting" | "stopped"

export interface RecorderStatus {
  state: Phase
  user: string
  currentFile?: string
  sessionDuration?: number
  lastPollTime?: string
  lastError?: string
}

export type RecorderEvent = keyof RecorderEventHandler

export interface RecordedFile {
  file: string
  duration: number
  size: number
}

/** One recording lifecycle channel: start → download → processing → end. */
export type RecordEvent =
  | { phase: "start"; user: string; file: string }
  | ({ phase: "download" } & RecordedFile)
  | { phase: "segment"; status: "start"; input: string; outputPattern: string }
  | { phase: "segment"; status: "end"; segments: number }
  | { phase: "convert"; status: "start"; input: string }
  | { phase: "convert"; status: "done"; input: string; output: string }
  | { phase: "normalize"; status: "start"; file: string }
  | { phase: "normalize"; status: "done"; input: string; output: string }
  | { phase: "normalize"; status: "error"; input: string; error: string }
  | ({ phase: "end" } & RecordedFile)

/** One download progress sample. The finished-download shape is `RecordedFile`. */
export interface DownloadProgress {
  bytes: number
  elapsed: number
  speed: number
}

/** Download and normalize progress share one spinner in the CLI. */
export type ProgressEvent =
  | ({ kind: "download" } & DownloadProgress)
  | { kind: "normalize"; file: string; percent: number; phase: "analyzing" | "normalizing" }

export interface RecorderEventHandler {
  verdict: (verdict: Verdict) => void
  record: (event: RecordEvent) => void
  progress: (event: ProgressEvent) => void
  failure: (err: TikTokError) => void
}

/** A `RecorderConfig` with every default applied — what the recorder runs on. */
export interface ResolvedConfig {
  user: string
  outputDir: string
  interval: number
  duration: number
  proxy?: string
  cookiesPath?: string
  cookies?: CookieAuth
  logLevel: LogLevel
  logConsole: boolean
  segmentMinutes: number
  normalizeAudio: boolean
  normalizeLoudness: number
  normalizeCodec?: string
  normalizeBitrate?: string
  ratePerSecond: number
  debug: boolean
}

/** Apply defaults once, at the entry point; nothing downstream re-reads `??`. */
export function resolveConfig(config: RecorderConfig): ResolvedConfig {
  return {
    user: config.user,
    outputDir: config.outputDir ?? ".",
    interval: config.interval ?? 3,
    duration: config.duration ?? 0,
    proxy: config.proxy,
    cookies: config.cookies,
    cookiesPath: config.cookiesPath,
    logLevel: config.logLevel ?? "info",
    logConsole: config.logConsole ?? true,
    segmentMinutes: config.segmentMinutes ?? 0,
    normalizeAudio: config.normalizeAudio ?? false,
    normalizeLoudness: config.normalizeLoudness ?? -14,
    normalizeCodec: config.normalizeCodec,
    normalizeBitrate: config.normalizeBitrate,
    ratePerSecond: config.ratePerSecond ?? 5,
    debug: config.debug ?? false,
  }
}

export function validateConfig(config: RecorderConfig): void {
  if (!config.user || config.user.trim().length === 0) {
    throw new TikTokError("config-error", "--user is required")
  }
  if (config.interval !== undefined && config.interval < 1) {
    throw new TikTokError("config-error", "--interval must be >= 1 minute")
  }
  if (config.duration !== undefined && config.duration < 0) {
    throw new TikTokError("config-error", "--duration must be >= 0 seconds")
  }
}
