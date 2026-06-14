/**
 * Polling monitor — calls a tick function on a configurable interval.
 * Fires the first tick immediately, then every N minutes.
 *
 * Uses an AbortController so stop() can interrupt the sleep between
 * ticks immediately, avoiding a busy 1-second polling loop.
 */

import type { Logger } from "./logger"
import { sleep } from "./utils"

export interface PollingMonitor {
  start: () => Promise<void>
  stop: () => Promise<void>
  /** Schedule the monitor to stop after the current tick completes. */
  stopAfterCurrentTick: () => void
}

export function createPollingMonitor(opts: {
  intervalMinutes: number
  onTick: () => Promise<void>
  logger?: Logger
}): PollingMonitor {
  const intervalMs = opts.intervalMinutes * 60 * 1000
  const stopSignal = new AbortController()
  let currentTick: Promise<void> | null = null
  let stopAfterTick = false

  async function start(): Promise<void> {
    opts.logger?.info(`Polling started (interval: ${opts.intervalMinutes} min)`)

    while (!stopSignal.signal.aborted) {
      currentTick = opts.onTick()
      try {
        await currentTick
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        opts.logger?.error(`Tick error: ${msg}`)
      } finally {
        currentTick = null
      }

      if (stopAfterTick) {
        stopSignal.abort()
      }
      if (stopSignal.signal.aborted) break

      // Sleep for the full interval — stop() aborts the signal to wake us up early
      await sleep(intervalMs, stopSignal.signal)
    }

    opts.logger?.info("Polling stopped")
  }

  async function stop(): Promise<void> {
    // Signal start() to exit the loop immediately
    stopSignal.abort()
    // Wait for in-flight tick to finish (e.g. recording → converting → MP4)
    if (currentTick) {
      await currentTick
    }
  }

  function stopAfterCurrentTick(): void {
    stopAfterTick = true
  }

  return { start, stop, stopAfterCurrentTick }
}
