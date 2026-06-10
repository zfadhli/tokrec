/**
 * CLI argument parser — uses koko-cli's createCLI (wraps cac).
 * Exports a single parseArgs() function.
 */

import { createCLI } from "@zfadhli/koko-cli"
import pkg from "../package.json"
import type { LogLevel, RecorderConfig } from "./config"
import { TikTokError } from "./config"
import { sanitizeUser } from "./utils"

export function parseArgs(argv: string[] = process.argv): RecorderConfig {
  let config: RecorderConfig | undefined
  let error: string | undefined

  const cli = createCLI("tiktok-live-recorder", pkg.version).description(
    "Minimal TikTok live stream recorder — Bun + TypeScript",
  )

  cli.command("", "Record a TikTok live stream", (cmd) => {
    cmd.option("-u, --user <name>", "TikTok username (or pass as first argument)")
    cmd.option("-o, --output <dir>", "Output directory", {
      default: "./recordings",
    })
    cmd.option("-i, --interval <minutes>", "Polling interval in minutes", {
      default: "3",
    })
    cmd.option("-d, --duration <minutes>", "Max recording duration in minutes")
    cmd.option("-p, --proxy <url>", "HTTP proxy (e.g. http://127.0.0.1:8080)")
    cmd.option("-l, --log-level <level>", "Log level: debug | info | warn | error")
    cmd.option("-c, --cookies <path>", "Path to cookies.json")
    cmd.option("-s, --segment-minutes <minutes>", "Segment duration in minutes", { default: "20" })
    cmd.option("--normalize", "Normalize audio loudness (EBU R128)")
    cmd.option("--normalize-loudness <num>", "Target loudness in LUFS (default: -14)")
    cmd.option("--normalize-codec <name>", "Audio codec for normalized output (default: aac)")
    cmd.option("--normalize-bitrate <str>", "Audio bitrate for normalized output (default: 128k)")

    cmd.action((opts: Record<string, unknown>) => {
      try {
        const user = opts.user as string | undefined
        if (!user) {
          throw new TikTokError("config-error", "<user> is required (positional or --user)")
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
            throw new TikTokError(
              "config-error",
              `--log-level must be one of: ${levels.join(", ")}`,
            )
          }
          parsed.logLevel = opts.logLevel as LogLevel
        }
        if (opts.cookies) parsed.cookiesPath = opts.cookies as string
        if (opts.segmentMinutes !== undefined) {
          const n = Number(opts.segmentMinutes)
          if (!Number.isFinite(n) || n < 1) {
            throw new TikTokError("config-error", "--segment-minutes must be a number >= 1")
          }
          parsed.segmentMinutes = n
        }

        if (opts.normalize) parsed.normalizeAudio = true
        if (opts.normalizeLoudness !== undefined) {
          const n = Number(opts.normalizeLoudness)
          if (!Number.isFinite(n)) {
            throw new TikTokError("config-error", "--normalize-loudness must be a number")
          }
          parsed.normalizeLoudness = n
        }
        if (opts.normalizeCodec) parsed.normalizeCodec = opts.normalizeCodec as string
        if (opts.normalizeBitrate) parsed.normalizeBitrate = opts.normalizeBitrate as string

        config = parsed
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }
    })
  })

  // If the first bare argument (not a flag or flag value) looks like a username,
  // convert it to --user for cac (which only handles options on the default command).
  const positionalUser = extractPositional(argv)
  if (positionalUser) {
    argv.push("--user", positionalUser)
  }

  cli.parse(argv)

  if (error) {
    throw new TikTokError("config-error", error)
  }

  if (!config) {
    throw new TikTokError(
      "config-error",
      "<user> is required (positional or --user). Use --help for usage.",
    )
  }

  return config
}

/**
 * Scan argv for the first bare argument that is neither a flag nor a flag's value.
 * Returns the value and removes it from the array, or null if none found.
 */
function extractPositional(argv: string[]): string | null {
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!
    // -- signals end of options; anything after is a positional
    if (arg === "--") {
      const pos = argv.splice(i, 1)[0]!
      return pos
    }
    // If this arg is a flag (-*) the next arg is its value
    if (arg.startsWith("-")) {
      // Skip the value if this flag takes one (not a boolean flag like --help/--version)
      const next = argv[i + 1]
      if (next && !next.startsWith("-") && arg !== "--help" && arg !== "--version") {
        i++ // skip the value
      }
      continue
    }
    // Found a bare positional — remove it and return
    argv.splice(i, 1)
    return arg
  }
  return null
}
