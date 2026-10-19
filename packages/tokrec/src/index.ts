/**
 * Library entry point — programmatic API for the TikTok Live Recorder.
 *
 * ```ts
 * import { createRecorder } from 'tiktok-live-recorder-bun'
 *
 * const recorder = createRecorder({ user: 'username', outputDir: './videos' })
 * recorder.on('recording:end', (info) => console.log('Done:', info.file))
 * await recorder.start()
 * ```
 */

export type {
  AppErrorKind,
  LiveReason,
  LogLevel,
  RecorderConfig,
  RecorderController,
  RecorderEvent,
  RecorderEventHandler,
  RecorderStatus,
} from "./lib/config"
export { TikTokError } from "./lib/config"
export { bytesToHuman, formatDuration, relativeTime, sanitizeUser } from "./lib/utils"
export { createRecorder } from "./session/index"
