/**
 * Typed event emitter for recorder lifecycle events.
 */

import type { RecorderEvent, RecorderEventHandler } from "../config"

export interface RecorderEventEmitter {
  on<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void
  off<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void
  emit<E extends RecorderEvent>(event: E, ...args: Parameters<RecorderEventHandler[E]>): void
  clear(): void
}

export function createEventEmitter(): RecorderEventEmitter {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()

  function on<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void {
    const list = handlers.get(event) ?? []
    list.push(handler as (...args: unknown[]) => void)
    handlers.set(event, list)
  }

  function off<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void {
    const list = handlers.get(event)
    if (!list) return
    const idx = list.indexOf(handler as (...args: unknown[]) => void)
    if (idx !== -1) list.splice(idx, 1)
  }

  function emit<E extends RecorderEvent>(
    event: E,
    ...args: Parameters<RecorderEventHandler[E]>
  ): void {
    const list = handlers.get(event)
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

  function clear(): void {
    handlers.clear()
  }

  return { on, off, emit, clear }
}
