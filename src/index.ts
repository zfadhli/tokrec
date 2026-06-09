#!/usr/bin/env bun
/**
 * Entry point — parses CLI args, creates the recorder, and handles signals.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { color } from '@zfadhli/koko-cli'
import { parseArgs } from './cli'
import { TikTokError, validateConfig } from './config'
import type { RecorderConfig } from './config'
import { createRecorder } from './lib'
import { createLogger } from './logger'

async function loadCookies(
  cookiesPath?: string,
): Promise<{ sessionid_ss: string; 'tt-target-idc'?: string } | undefined> {
  const path = cookiesPath ?? join(process.cwd(), 'cookies.json')
  if (!existsSync(path)) {
    return undefined
  }
  try {
    const content = readFileSync(path, 'utf-8')
    const data = JSON.parse(content) as { sessionid_ss?: string; 'tt-target-idc'?: string }
    if (data.sessionid_ss && data.sessionid_ss.length > 0) {
      return data as { sessionid_ss: string; 'tt-target-idc'?: string }
    }
    return undefined
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  let config: RecorderConfig

  try {
    config = parseArgs()
    validateConfig(config)
  } catch (err) {
    if (err instanceof TikTokError && err.kind === 'config-error') {
      console.error(`${color.red('Error:')} ${err.message}`)
      process.exit(1)
    }
    throw err
  }

  // Load cookies
  const cookies = await loadCookies(config.cookiesPath)
  if (cookies) {
    config.cookies = cookies
  }

  const logger = createLogger({ level: config.logLevel })

  const recorder = createRecorder(config)

  // Subscribe to events for console output
  recorder.on('recording:start', (info) => {
    logger.info(`Recording started for @${info.user}`)
  })

  recorder.on('recording:end', (info) => {
    logger.info(`Recording saved: ${info.file} (${info.duration.toFixed(1)}s, ${info.size} bytes)`)
  })

  recorder.on('converted', (info) => {
    logger.info(`Converted to MP4: ${info.output}`)
  })

  recorder.on('error', (err) => {
    logger.error(`[${err.kind}] ${err.message}`)
  })

  // Signal handling
  let stopping = false
  const handleSignal = async () => {
    if (stopping) {
      logger.warn('Force stopping...')
      process.exit(1)
    }
    stopping = true
    logger.info('Shutting down gracefully...')
    await recorder.stop()
    process.exit(0)
  }

  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)

  // Start the recorder
  try {
    await recorder.start()
  } catch (err) {
    if (err instanceof TikTokError) {
      logger.error(`[${err.kind}] ${err.message}`)
    } else {
      logger.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    }
    await recorder.stop()
    process.exit(1)
  }
}

main()
