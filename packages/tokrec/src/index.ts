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
  LiveReason,
  LogLevel,
  Phase,
  ProgressEvent,
  RecordEvent,
  RecordedFile,
  RecorderConfig,
  RecorderController,
  RecorderEvent,
  RecorderEventHandler,
  RecorderStatus,
} from "./app/config"
export { createRecorder } from "./app/recorder"
export type { TikTokErrorCode } from "./core/errors"
export { TikTokError } from "./core/errors"
export { bytesToHuman, formatDuration, relativeTime, sanitizeUser } from "./core/format"
export type {
  Evidence,
  EvidenceOutcome,
  RoomRef,
  SourceId,
  StreamRef,
  Verdict,
} from "./core/verdict"
export { isLiveReason } from "./core/verdict"
