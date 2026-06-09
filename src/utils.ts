/**
 * Utility helpers — pure functions, no side effects.
 */

import { mkdirSync } from "node:fs"

/** Format a filename like username=2025.06.09_14-30-00_1.flv */
export function formatFilename(user: string, ext = "flv", part?: number): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const partSuffix = part !== undefined ? `_part${part}` : ""
  return `${user}=${date}_${time}${partSuffix}.${ext}`
}

/** Ensure a directory exists (recursive) */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

/** Sleep for ms milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Format bytes to human-readable size */
export function bytesToHuman(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

/** Strip leading @ from a username */
export function sanitizeUser(user: string): string {
  return user.replace(/^@+/, "").trim()
}

/** Format a millisecond elapsed time as a relative human-readable string. */
export function relativeTime(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 5) return "just now"
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  const mins = min % 60
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
