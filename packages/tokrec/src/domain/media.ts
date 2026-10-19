/**
 * Media domain types — download progress and the result of a finished download.
 *
 * Pure domain type: no I/O, no imports outside `domain/`.
 */

export interface ProgressInfo {
  bytes: number
  elapsed: number
  speed: number
}

export interface DownloadResult {
  file: string
  duration: number
  size: number
}
