/**
 * Recorder orchestrator — wires together the API, monitor, stream downloader,
 * and converter into a single RecorderController.
 *
 * This is the only public API surface of the entire application.
 */

import { createHttpClient } from '../api/client'
import { type TikTokApi, createTikTokApi } from '../api/tiktok'
import type {
  RecorderConfig,
  RecorderController,
  RecorderEvent,
  RecorderEventHandler,
  RecorderStatus,
} from '../config'
import { TikTokError, normalizeConfig } from '../config'
import { createLogger } from '../logger'
import { type PollingMonitor, createPollingMonitor } from '../monitor'
import { type Converter, createConverter } from './convert'
import { type StreamDownloader, createStreamDownloader } from './stream'

export function createRecorder(config: RecorderConfig): RecorderController {
  const cfg = normalizeConfig(config)
  const logger = createLogger({ level: cfg.logLevel, logFile: 'tiktok-recorder.log' })

  // Internal event registry (simpler to use Map than Partial<Record<...>>)
  const eventHandlers = new Map<string, Array<(...args: any[]) => void>>()

  let state: RecorderStatus = {
    state: 'idle',
    user: cfg.user,
  }

  // State machine
  let httpClient: Awaited<ReturnType<typeof createHttpClient>> | null = null
  let api: TikTokApi | null = null
  let monitor: PollingMonitor | null = null
  let downloader: StreamDownloader | null = null
  let converter: Converter | null = null
  let stopRequested = false

  function setState(partial: Partial<RecorderStatus>): void {
    state = { ...state, ...partial }
  }

  function getStatus(): RecorderStatus {
    return { ...state }
  }

  function on<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void {
    const list = eventHandlers.get(event) ?? []
    list.push(handler as (...args: any[]) => void)
    eventHandlers.set(event, list)
  }

  function emit<E extends RecorderEvent>(
    event: E,
    ...args: Parameters<RecorderEventHandler[E]>
  ): void {
    const list = eventHandlers.get(event)
    if (list) {
      for (const h of list) {
        try {
          h(...args)
        } catch {
          // Never let an event handler crash the recorder
        }
      }
    }
  }

  async function start(): Promise<void> {
    stopRequested = false

    // Initialize HTTP client with TLS fingerprinting
    logger.info(`Starting recorder for @${cfg.user}`)
    httpClient = await createHttpClient(cfg)

    // Initialize API
    api = createTikTokApi(httpClient)

    // Initialize recorder components
    downloader = createStreamDownloader(logger)
    converter = createConverter(logger)

    // Start polling
    monitor = createPollingMonitor({
      intervalMinutes: cfg.interval,
      logger,
      onTick: async () => {
        if (stopRequested) return

        const user = cfg.user

        // Invalidate cache so we get fresh data from TikTok
        api!.invalidateCache()

        logger.info(`Checking @${user}...`)

        // Single call fetches SIGI_STATE and extracts everything
        const roomId = await api!.getRoomId(user)
        if (!roomId) {
          logger.info(`@${user} is offline`)
          emit('tick', { user, isLive: false })
          return
        }

        // `getRoomId` only returns a roomId when the user is live (status 2),
        // so no separate liveness check is needed.

        const liveUrl = await api!.getLiveUrl(roomId)
        if (!liveUrl) {
          logger.warn(`@${user} is live but no stream URL found`)
          emit('tick', { user, isLive: false })
          return
        }

        logger.info(`@${user} is LIVE! (room: ${roomId})`)
        emit('tick', { user, isLive: true })

        // Record the stream
        setState({ state: 'recording' })
        emit('recording:start', { user, file: '' })

        const result = await downloader!.download(liveUrl, user, cfg.outputDir, cfg.duration)

        setState({
          currentFile: result.file,
          sessionDuration: result.duration,
        })
        emit('recording:end', {
          file: result.file,
          duration: result.duration,
          size: result.size,
        })

        // 5. Convert to MP4
        if (result.size > 0) {
          setState({ state: 'converting' })
          try {
            const mp4File = await converter!.convert(result.file)
            emit('converted', { input: result.file, output: mp4File })
          } catch (err) {
            const tkErr = err instanceof TikTokError ? err : new TikTokError('unknown', String(err))
            logger.error(`Conversion failed: ${tkErr.message}`)
            emit('error', tkErr)
          }
        }

        setState({ state: 'polling' })
      },
    })

    setState({ state: 'polling' })
    await monitor.start()
  }

  async function stop(): Promise<void> {
    stopRequested = true
    logger.info('Stopping recorder...')
    // Signal download to stop FIRST so the in-flight tick can finish
    // and proceed to convert the recording. Then wait for the tick.
    if (downloader) downloader.abort()
    if (monitor) await monitor.stop()
    if (httpClient) await httpClient.close()
    setState({ state: 'stopped' })
    logger.info('Recorder stopped')
  }

  return {
    start,
    stop,
    getStatus,
    on,
  }
}
