/**
 * Config — types, defaults, and normalization for the recorder.
 * The single source of truth for every user-facing option.
 */

export interface CookieAuth {
  sessionid_ss: string
  "tt-target-idc"?: string
}

export type LogLevel = "debug" | "info" | "warn" | "error"

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
  /** Segment duration in minutes (default: 20). Stream is cut into segments of this length. */
  segmentMinutes?: number
  /** Normalize audio loudness via EBU R128 (default: false). */
  normalizeAudio?: boolean
  /** Target loudness in LUFS (default: -14). */
  normalizeLoudness?: number
  /** Audio codec for normalized output (default: "aac"). */
  normalizeCodec?: string
  /** Audio bitrate for normalized output (default: "128k"). */
  normalizeBitrate?: string
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
}

export interface RecorderStatus {
  state: "idle" | "polling" | "recording" | "converting" | "stopped"
  user: string
  currentFile?: string
  sessionDuration?: number
  lastPollTime?: string
  lastError?: string
}

export type RecorderEvent = keyof RecorderEventHandler

export interface RecorderEventHandler {
  checking: (info: { user: string }) => void
  tick: (info: { user: string; isLive: boolean; roomId?: string }) => void
  "recording:start": (info: { user: string; file: string }) => void
  "download:progress": (info: {
    bytes: number
    elapsed: number
    speed: number
  }) => void
  "download:end": (info: {
    file: string
    duration: number
    size: number
  }) => void
  "recording:end": (info: {
    file: string
    duration: number
    size: number
  }) => void
  "segmenting:start": (info: { input: string; outputPattern: string }) => void
  "segmenting:end": (info: { segments: number }) => void
  "converting:start": (info: { input: string }) => void
  converted: (info: { input: string; output: string }) => void
  "normalize:start": (info: { file: string }) => void
  "normalize:progress": (info: {
    file: string
    percent: number
    phase: "analyzing" | "normalizing"
  }) => void
  "normalize:end": (info: { input: string; output: string }) => void
  "normalize:error": (info: { input: string; error: string }) => void
  error: (err: TikTokError) => void
}

export type AppErrorKind =
  | "user-not-live"
  | "room-not-found"
  | "stream-url-not-found"
  | "waf-blocked"
  | "country-blocked"
  | "network-error"
  | "ffmpeg-not-found"
  | "config-error"
  | "unknown"

export class TikTokError extends Error {
  constructor(
    public readonly kind: AppErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = "TikTokError"
  }
}

const DEFAULTS = {
  outputDir: "./recordings",
  interval: 3,
  duration: 0,
  logLevel: "info" as LogLevel,
  logConsole: true,
  segmentMinutes: 20,
  normalizeAudio: false,
  normalizeLoudness: -14,
  normalizeCodec: "aac",
  normalizeBitrate: "128k",
}

export function normalizeConfig(
  config: RecorderConfig,
): Required<Omit<RecorderConfig, "cookies" | "cookiesPath" | "proxy">> &
  Pick<RecorderConfig, "cookies" | "cookiesPath" | "proxy"> {
  return {
    user: config.user,
    outputDir: config.outputDir ?? DEFAULTS.outputDir,
    interval: config.interval ?? DEFAULTS.interval,
    duration: config.duration ?? DEFAULTS.duration,
    logLevel: config.logLevel ?? DEFAULTS.logLevel,
    logConsole: config.logConsole ?? DEFAULTS.logConsole,
    proxy: config.proxy,
    cookies: config.cookies,
    cookiesPath: config.cookiesPath,
    segmentMinutes: config.segmentMinutes ?? DEFAULTS.segmentMinutes,
    normalizeAudio: config.normalizeAudio ?? DEFAULTS.normalizeAudio,
    normalizeLoudness: config.normalizeLoudness ?? DEFAULTS.normalizeLoudness,
    normalizeCodec: config.normalizeCodec ?? DEFAULTS.normalizeCodec,
    normalizeBitrate: config.normalizeBitrate ?? DEFAULTS.normalizeBitrate,
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
