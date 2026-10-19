/**
 * Typed emitter over `node:events` — the four-channel recorder contract
 * (`verdict`, `record`, `progress`, `failure`) with no listener bookkeeping of
 * our own. `emit` swallows handler throws: a bad subscriber must not kill a
 * recording.
 */

import { EventEmitter } from "node:events"
import type { RecorderEvent, RecorderEventHandler } from "./config"

export interface RecorderEventEmitter {
  on<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void
  off<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void
  emit<E extends RecorderEvent>(event: E, ...args: Parameters<RecorderEventHandler[E]>): void
  clear(): void
}

export function createEventEmitter(): RecorderEventEmitter {
  const emitter = new EventEmitter()
  const asListener = (handler: unknown) => handler as (...args: unknown[]) => void

  function on<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void {
    emitter.on(event, asListener(handler))
  }

  function off<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void {
    emitter.off(event, asListener(handler))
  }

  function emit<E extends RecorderEvent>(
    event: E,
    ...args: Parameters<RecorderEventHandler[E]>
  ): void {
    try {
      emitter.emit(event, ...args)
    } catch {
      // Never let an event handler crash the recorder.
    }
  }

  function clear(): void {
    emitter.removeAllListeners()
  }

  return { on, off, emit, clear }
}
