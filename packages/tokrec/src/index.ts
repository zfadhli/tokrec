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
  Evidence,
  EvidenceOutcome,
  RoomRef,
  SourceId,
  StreamRef,
  Verdict,
} from "./domain/verdict"
export { isLiveReason } from "./domain/verdict"
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
  TikTokErrorCode,
} from "./lib/config"
export { TikTokError } from "./lib/config"
export { bytesToHuman, formatDuration, relativeTime, sanitizeUser } from "./lib/utils"
export { createRecorder } from "./session/index"
