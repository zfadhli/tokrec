/**
 * CLI argument parser — thin wrapper over cac.
 * Exports a single parseArgs() function.
 */

import type { LogLevel, RecorderConfig } from "@zfadhli/tokrec"
import { sanitizeUser, TikTokError } from "@zfadhli/tokrec"
import cac, { type Command } from "cac"
import * as color from "yoctocolors"
import pkg from "../package.json"

export type CLIResult =
  | { command: "record"; config: RecorderConfig }
  | { command: "start"; args: string[] }
  | { command: "stop"; user?: string }
  | { command: "status"; user?: string }
  | { command: "setup" }

/** Shared recorder options for both default and start commands. */
function registerRecorderOptions(cmd: Command) {
  cmd.option("-u, --user <name>", "TikTok username (or pass as first argument)")
  cmd.option("-o, --output <dir>", "Output directory", {
    default: ".",
  })
  cmd.option("-i, --interval <minutes>", "Polling interval in minutes", {
    default: "3",
  })
  cmd.option("-d, --duration <minutes>", "Max recording duration in minutes")
  cmd.option("-p, --proxy <url>", "HTTP proxy (e.g. http://127.0.0.1:8080)")
  cmd.option("-l, --log-level <level>", "Log level: debug | info | warn | error")
  cmd.option("-c, --cookies <path>", "Path to cookies.json")
  cmd.option(
    "-s, --segment-minutes <minutes>",
    "Segment duration in minutes (default: disabled). Split recording into segments of this length.",
  )
  cmd.option("--normalize", "Normalize audio loudness (EBU R128)")
  cmd.option("--normalize-loudness <num>", "Target loudness in LUFS (default: -14)")
  cmd.option("--normalize-codec <name>", "Audio codec for normalized output (default: libopus)")
  cmd.option("--normalize-bitrate <str>", "Audio bitrate for normalized output (default: 96k)")
  cmd.option("--rate <n>", "Max API requests per second (default: 5). Set 0 for unlimited.")
  cmd.option("--debug", "Show API debug logging on stderr for troubleshooting")
}

function parseRecorderOpts(opts: Record<string, unknown>): RecorderConfig {
  const user = opts.user as string | undefined
  if (!user) {
    throw new TikTokError("config-error", "<user> is required (--user or -u)")
  }

  const parsed: RecorderConfig = {
    user: sanitizeUser(user),
  }

  if (opts.output) parsed.outputDir = opts.output as string
  if (opts.interval !== undefined) {
    const n = Number(opts.interval)
    if (!Number.isFinite(n) || n < 1) {
      throw new TikTokError("config-error", "--interval must be a number >= 1")
    }
    parsed.interval = n
  }
  if (opts.duration !== undefined) {
    const n = Number(opts.duration)
    if (!Number.isFinite(n) || n < 0) {
      throw new TikTokError("config-error", "--duration must be a number >= 0 (minutes)")
    }
    parsed.duration = n * 60
  }
  if (opts.proxy) parsed.proxy = opts.proxy as string
  if (opts.logLevel) {
    const levels = ["debug", "info", "warn", "error"]
    if (!levels.includes(opts.logLevel as string)) {
      throw new TikTokError("config-error", `--log-level must be one of: ${levels.join(", ")}`)
    }
    parsed.logLevel = opts.logLevel as LogLevel
  }
  if (opts.cookies) parsed.cookiesPath = opts.cookies as string
  if (opts.segmentMinutes !== undefined) {
    const n = Number(opts.segmentMinutes)
    if (!Number.isFinite(n) || n < 0) {
      throw new TikTokError("config-error", "--segment-minutes must be a number >= 0")
    }
    parsed.segmentMinutes = n
  }
  if (opts.normalize !== undefined) parsed.normalizeAudio = opts.normalize as boolean
  if (opts.normalizeLoudness !== undefined) {
    const n = Number(opts.normalizeLoudness)
    if (!Number.isFinite(n)) {
      throw new TikTokError("config-error", "--normalize-loudness must be a number")
    }
    parsed.normalizeLoudness = n
  }
  if (opts.normalizeCodec) parsed.normalizeCodec = opts.normalizeCodec as string
  if (opts.normalizeBitrate) parsed.normalizeBitrate = opts.normalizeBitrate as string
  if (opts.rate !== undefined) {
    const n = Number(opts.rate)
    if (!Number.isFinite(n) || n < 0) {
      throw new TikTokError("config-error", "--rate must be a number >= 0")
    }
    parsed.ratePerSecond = n
  }
  if (opts.debug) parsed.debug = true

  return parsed
}

/** styled startup banner, printed before each command action (stderr) */
function banner(): void {
  console.error(`${color.bold(color.cyan("tokrec"))} ${color.yellow(`v${pkg.version}`)}`)
}

export function parseArgs(argv: string[] = process.argv): CLIResult {
  let result: CLIResult | undefined
  let error: string | undefined

  const cli = cac("tokrec")
  cli.version(pkg.version)
  cli.help()
  cli.usage("Minimal TikTok live stream recorder — Bun + TypeScript")

  const record = cli.command("", "Record a TikTok live stream")
  registerRecorderOptions(record)
  record.action((opts: Record<string, unknown>) => {
    banner()
    try {
      result = { command: "record", config: parseRecorderOpts(opts) }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  })

  const start = cli.command("start", "Start recorder in a tmux session (survives terminal close)")
  registerRecorderOptions(start)
  start.action((opts: Record<string, unknown>) => {
    banner()
    try {
      parseRecorderOpts(opts)
      // Pass through original args (minus 'start') to the inner tokrec process
      const args = argv.slice(2).filter((a) => a !== "start")
      result = { command: "start", args }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  })

  const stop = cli.command("stop", "Stop background tmux session(s)")
  stop.option("-u, --user <name>", "Stop a specific user's session (omit to stop all)")
  stop.action((opts: Record<string, unknown>) => {
    banner()
    result = { command: "stop", user: opts.user as string | undefined }
  })

  const status = cli.command("status", "Check tmux session(s)")
  status.option("-u, --user <name>", "Check a specific user's session (omit to show all)")
  status.action((opts: Record<string, unknown>) => {
    banner()
    result = { command: "status", user: opts.user as string | undefined }
  })

  const setup = cli.command("setup", "Check cookie status or create cookies.json interactively")
  setup.action(() => {
    banner()
    result = { command: "setup" }
  })

  cli.parse(argv)

  if (error) {
    throw new TikTokError("config-error", error)
  }

  if (!result) {
    throw new TikTokError(
      "config-error",
      "<user> is required (--user or -u). Use --help for usage.",
    )
  }

  return result
}
