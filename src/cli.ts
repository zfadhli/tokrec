/**
 * CLI argument parser — uses koko-cli's createCLI (wraps cac).
 * Exports a single parseArgs() function.
 */

import { createCLI } from '@zfadhli/koko-cli'
import type { LogLevel, RecorderConfig } from './config'
import { TikTokError } from './config'
import { sanitizeUser } from './utils'

export function parseArgs(argv: string[] = process.argv): RecorderConfig {
  let config: RecorderConfig | undefined
  let error: string | undefined

  const cli = createCLI('tiktok-live-recorder', '0.1.1').description(
    'Minimal TikTok live stream recorder — Bun + TypeScript',
  )

  cli.command('', 'Record a TikTok live stream', (cmd) => {
    cmd.option('-u, --user <name>', 'TikTok username (required)')
    cmd.option('-o, --output <dir>', 'Output directory', { default: './recordings' })
    cmd.option('-i, --interval <minutes>', 'Polling interval in minutes', { default: '5' })
    cmd.option('-d, --duration <seconds>', 'Max recording duration in seconds')
    cmd.option('-p, --proxy <url>', 'HTTP proxy (e.g. http://127.0.0.1:8080)')
    cmd.option('-l, --log-level <level>', 'Log level: debug | info | warn | error')
    cmd.option('-c, --cookies <path>', 'Path to cookies.json')

    cmd.action((opts: Record<string, unknown>) => {
      try {
        const user = opts.user as string | undefined
        if (!user) {
          throw new TikTokError('config-error', '--user is required')
        }

        const parsed: RecorderConfig = {
          user: sanitizeUser(user),
        }

        if (opts.output) parsed.outputDir = opts.output as string
        if (opts.interval !== undefined) {
          const n = Number(opts.interval)
          if (!Number.isFinite(n) || n < 1) {
            throw new TikTokError('config-error', '--interval must be a number >= 1')
          }
          parsed.interval = n
        }
        if (opts.duration !== undefined) {
          const n = Number(opts.duration)
          if (!Number.isFinite(n) || n < 0) {
            throw new TikTokError('config-error', '--duration must be a number >= 0')
          }
          parsed.duration = n
        }
        if (opts.proxy) parsed.proxy = opts.proxy as string
        if (opts.logLevel) {
          const levels = ['debug', 'info', 'warn', 'error']
          if (!levels.includes(opts.logLevel as string)) {
            throw new TikTokError(
              'config-error',
              `--log-level must be one of: ${levels.join(', ')}`,
            )
          }
          parsed.logLevel = opts.logLevel as LogLevel
        }
        if (opts.cookies) parsed.cookiesPath = opts.cookies as string

        config = parsed
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }
    })
  })

  cli.parse(argv)

  if (error) {
    throw new TikTokError('config-error', error)
  }

  if (!config) {
    throw new TikTokError('config-error', '--user is required. Use --help for usage.')
  }

  return config
}
