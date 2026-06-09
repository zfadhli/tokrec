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

export { createRecorder } from "./recorder/index"
export type {
  AppErrorKind,
  RecorderConfig,
  RecorderController,
  RecorderEvent,
  RecorderEventHandler,
  RecorderStatus,
  TikTokError,
} from "./config"
