/**
 * Polling monitor — calls a tick function on a configurable interval.
 * Fires the first tick immediately, then every N minutes.
 */

import type { Logger } from "./logger";
import { sleep } from "./utils";

export interface PollingMonitor {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createPollingMonitor(opts: {
  intervalMinutes: number;
  onTick: () => Promise<void>;
  logger?: Logger;
}): PollingMonitor {
  const intervalMs = opts.intervalMinutes * 60 * 1000;
  let active = true;
  let currentTick: Promise<void> | null = null;

  async function start(): Promise<void> {
    active = true;
    opts.logger?.info(
      `Polling started (interval: ${opts.intervalMinutes} min)`,
    );

    while (active) {
      currentTick = opts.onTick();
      try {
        await currentTick;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        opts.logger?.error(`Tick error: ${msg}`);
      } finally {
        currentTick = null;
      }

      if (!active) break;

      // Wait for the interval, checking periodically if we should stop
      const checkInterval = 1000; // check every second
      let waited = 0;
      while (waited < intervalMs) {
        if (!active) break;
        await sleep(Math.min(checkInterval, intervalMs - waited));
        waited += checkInterval;
      }
    }

    opts.logger?.info("Polling stopped");
  }

  async function stop(): Promise<void> {
    active = false;
    // Wait for in-flight tick to finish (e.g. recording → converting → MP4)
    if (currentTick) {
      await currentTick;
    }
  }

  return { start, stop };
}
