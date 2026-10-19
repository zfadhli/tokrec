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

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"]

/**
 * One row per `RecorderConfig` field the CLI exposes. The flag string is the
 * only declaration: `cmd.option()` and the argv → config mapping both read this
 * table, so a new option is one row instead of two edits in two shapes.
 */
interface OptionSpec {
  flags: string
  description: string
  /** cac default, passed through to `cmd.option`. */
  default?: string
  /** Merge into the config. Only called when argv carried the option. */
  apply: (config: RecorderConfig, raw: unknown) => void
}

/** `-i, --interval <minutes>` → `interval`, the key cac writes into `opts`. */
function optsKey(flags: string): string {
  const long = flags.split(",").at(-1)?.trim() ?? flags
  const name = long.replace(/^--/, "").split(" ")[0] ?? ""
  return name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())
}

/** Typed setter: coerce the raw argv string, then write the named field. */
function set<K extends keyof RecorderConfig>(
  key: K,
  parse: (raw: string) => RecorderConfig[K],
): OptionSpec["apply"] {
  return (config, raw) => {
    config[key] = parse(String(raw))
  }
}

function numberOf(raw: string, message: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new TikTokError("config-error", message)
  return n
}

/** Parse `raw`, require `>= min`, optionally scale (minutes → seconds). */
function atLeast(min: number, message: string, scale = 1) {
  return (raw: string): number => {
    const n = numberOf(raw, message)
    if (n < min) throw new TikTokError("config-error", message)
    return n * scale
  }
}

const OPTIONS: OptionSpec[] = [
  {
    flags: "-o, --output <dir>",
    description: "Output directory",
    default: ".",
    apply: set("outputDir", (raw) => raw),
  },
  {
    flags: "-i, --interval <minutes>",
    description: "Polling interval in minutes",
    default: "3",
    apply: set("interval", atLeast(1, "--interval must be a number >= 1")),
  },
  {
    flags: "-d, --duration <minutes>",
    description: "Max recording duration in minutes",
    apply: set("duration", atLeast(0, "--duration must be a number >= 0 (minutes)", 60)),
  },
  {
    flags: "-p, --proxy <url>",
    description: "HTTP proxy (e.g. http://127.0.0.1:8080)",
    apply: set("proxy", (raw) => raw),
  },
  {
    flags: "-l, --log-level <level>",
    description: "Log level: debug | info | warn | error",
    apply: set("logLevel", (raw) => {
      if (!LOG_LEVELS.includes(raw as LogLevel)) {
        throw new TikTokError(
          "config-error",
          `--log-level must be one of: ${LOG_LEVELS.join(", ")}`,
        )
      }
      return raw as LogLevel
    }),
  },
  {
    flags: "-c, --cookies <path>",
    description: "Path to cookies.json",
    apply: set("cookiesPath", (raw) => raw),
  },
  {
    flags: "-s, --segment-minutes <minutes>",
    description:
      "Segment duration in minutes (default: disabled). Split recording into segments of this length.",
    apply: set("segmentMinutes", atLeast(0, "--segment-minutes must be a number >= 0")),
  },
  {
    flags: "--normalize",
    description: "Normalize audio loudness (EBU R128)",
    apply: (config) => {
      config.normalizeAudio = true
    },
  },
  {
    flags: "--normalize-loudness <num>",
    description: "Target loudness in LUFS (default: -14)",
    apply: set("normalizeLoudness", (raw) =>
      numberOf(raw, "--normalize-loudness must be a number"),
    ),
  },
  {
    flags: "--normalize-codec <name>",
    description: "Audio codec for normalized output (default: libopus)",
    apply: set("normalizeCodec", (raw) => raw),
  },
  {
    flags: "--normalize-bitrate <str>",
    description: "Audio bitrate for normalized output (default: 96k)",
    apply: set("normalizeBitrate", (raw) => raw),
  },
  {
    flags: "--rate <n>",
    description: "Max API requests per second (default: 5). Set 0 for unlimited.",
    apply: set("ratePerSecond", atLeast(0, "--rate must be a number >= 0")),
  },
  {
    flags: "--debug",
    description: "Show API debug logging on stderr for troubleshooting",
    apply: (config) => {
      config.debug = true
    },
  },
]

/** Shared recorder options for both default and start commands. */
function registerRecorderOptions(cmd: Command): void {
  cmd.option("-u, --user <name>", "TikTok username (or pass as first argument)")
  for (const option of OPTIONS) {
    cmd.option(
      option.flags,
      option.description,
      option.default === undefined ? {} : { default: option.default },
    )
  }
}

function parseRecorderOpts(opts: Record<string, unknown>): RecorderConfig {
  const user = opts.user as string | undefined
  if (!user) {
    throw new TikTokError("config-error", "<user> is required (--user or -u)")
  }

  const parsed: RecorderConfig = { user: sanitizeUser(user) }
  for (const option of OPTIONS) {
    const raw = opts[optsKey(option.flags)]
    if (raw === undefined) continue
    option.apply(parsed, raw)
  }
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
