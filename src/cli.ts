/**
 * CLI argument parser — uses Bun.argv directly (no commander/yargs dependency).
 * Exports a single parseArgs() function.
 */

import type { LogLevel, RecorderConfig } from './config'
import { TikTokError } from './config'
import { sanitizeUser } from './utils'

const HELP_TEXT = `
TikTok Live Recorder — minimal Bun + TypeScript live stream recorder.

USAGE
  bun run src/index.ts --user <username> [options]

OPTIONS
  --user <username>         TikTok username to record (required)
  --output <dir>            Output directory (default: ./recordings)
  --interval <minutes>      Polling interval in minutes (default: 5)
  --duration <seconds>      Max recording duration (default: unlimited)
  --proxy <url>             HTTP proxy (e.g. http://127.0.0.1:8080)
  --cookies <path>          Path to cookies.json (default: ./cookies.json)
  --log-level <level>       Log level: debug | info | warn | error (default: info)
  --help                    Show this help

EXAMPLES
  bun run src/index.ts --user officialgeilegisela
  bun run src/index.ts --user officialgeilegisela --output ./videos --interval 2
  bun run src/index.ts --user officialgeilegisela --proxy http://127.0.0.1:8080
`

interface RawArgs {
  user?: string
  output?: string
  interval?: string
  duration?: string
  proxy?: string
  cookies?: string
  logLevel?: string
  help?: boolean
}

function parseRawArgs(argv: string[]): RawArgs {
  const raw: Record<string, string | boolean | undefined> = {}
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue
    if (arg === '--help') {
      raw.help = true
      continue
    }
    if (!arg.startsWith('--')) {
      throw new TikTokError('config-error', `Unknown argument: ${arg}. Use --help for usage.`)
    }
    const rawKey = arg.slice(2)
    // Convert kebab-case to camelCase (e.g. log-level → logLevel)
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const val = argv[i + 1]
    if (!val || val.startsWith('--')) {
      throw new TikTokError('config-error', `Missing value for ${arg}`)
    }
    raw[key] = val
    i++ // skip next (the value)
  }
  return raw as RawArgs
}

export function printHelp(): void {
  console.log(HELP_TEXT)
}

export function parseArgs(argv: string[] = process.argv): RecorderConfig {
  const raw = parseRawArgs(argv)

  if (raw.help) {
    printHelp()
    process.exit(0)
  }

  if (!raw.user) {
    throw new TikTokError('config-error', '--user is required. Use --help for usage.')
  }

  const config: RecorderConfig = {
    user: sanitizeUser(raw.user),
  }

  if (raw.output) config.outputDir = raw.output
  if (raw.interval) {
    const n = Number(raw.interval)
    if (!Number.isFinite(n) || n < 1) {
      throw new TikTokError('config-error', '--interval must be a number >= 1')
    }
    config.interval = n
  }
  if (raw.duration) {
    const n = Number(raw.duration)
    if (!Number.isFinite(n) || n < 0) {
      throw new TikTokError('config-error', '--duration must be a number >= 0')
    }
    config.duration = n
  }
  if (raw.proxy) config.proxy = raw.proxy
  if (raw.logLevel) {
    const levels = ['debug', 'info', 'warn', 'error']
    if (!levels.includes(raw.logLevel)) {
      throw new TikTokError('config-error', `--log-level must be one of: ${levels.join(', ')}`)
    }
    config.logLevel = raw.logLevel as LogLevel
  }

  return config
}
