/**
 * Utility helpers — pure functions, no side effects.
 */

import { mkdirSync } from "node:fs";

/** Format a filename like username=2025.06.09_14-30-00_1.flv */
export function formatFilename(
  user: string,
  ext = "flv",
  part?: number,
): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const partSuffix = part !== undefined ? `_part${part}` : "";
  return `${user}=${date}_${time}${partSuffix}.${ext}`;
}

/** Ensure a directory exists (recursive) */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** Sleep for ms milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format bytes to human-readable size */
export function bytesToHuman(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

/** Strip leading @ from a username */
export function sanitizeUser(user: string): string {
  return user.replace(/^@+/, "").trim();
}
