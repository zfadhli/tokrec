/**
 * Logger contract — the interface every adapter writes through.
 *
 * Pure band: `io/` may not import `app/`, and the adapters all take a logger.
 * The rotating-file implementation is `app/logger.ts`.
 */

export interface Logger {
  debug: (msg: string, ...args: unknown[]) => void
  info: (msg: string, ...args: unknown[]) => void
  warn: (msg: string, ...args: unknown[]) => void
  error: (msg: string, ...args: unknown[]) => void
}
