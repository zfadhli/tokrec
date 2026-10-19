/**
 * Polling monitor — calls a tick function on a configurable interval.
 * Fires the first tick immediately, then every N minutes.
 *
 * One external `AbortSignal` (the session's AbortScope) interrupts both the
 * sleep and any in-flight tick; there is no private controller.
 */

import type { Logger } from "../core/log"

/** Sleep for `ms`, resolving early when `signal` aborts (timer cleared, no orphan). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    }
  })
}

export interface PollingMonitor {
  start: () => Promise<void>
  stop: () => Promise<void>
  /** Schedule the monitor to stop after the current tick completes. */
  stopAfterCurrentTick: () => void
}

export function createPollingMonitor(opts: {
  intervalMinutes: number
  signal: AbortSignal
  onTick: () => Promise<void>
  logger?: Logger
}): PollingMonitor {
  const intervalMs = opts.intervalMinutes * 60 * 1000
  let currentTick: Promise<void> | null = null
  let stopAfterTick = false

  async function start(): Promise<void> {
    opts.logger?.info(`Polling started (interval: ${opts.intervalMinutes} min)`)

    while (!opts.signal.aborted) {
      currentTick = opts.onTick()
      try {
        await currentTick
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        opts.logger?.error(`Tick error: ${msg}`)
      } finally {
        currentTick = null
      }

      if (stopAfterTick || opts.signal.aborted) break

      // Sleep for the full interval — close() aborts the signal to wake us up early
      await sleep(intervalMs, opts.signal)
    }

    opts.logger?.info("Polling stopped")
  }

  async function stop(): Promise<void> {
    // Wait for in-flight tick to finish; close() only aborts its I/O.
    if (currentTick) {
      await currentTick
    }
  }

  function stopAfterCurrentTick(): void {
    stopAfterTick = true
  }

  return { start, stop, stopAfterCurrentTick }
}
