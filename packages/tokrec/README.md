# @zfadhli/tokrec

Library half of [tokrec](https://github.com/zfadhli/tokrec) — polls a TikTok user's live status, records the stream while it is live, and returns playable MP4 files.

[![npm version](https://img.shields.io/npm/v/@zfadhli/tokrec?style=flat-square)](https://www.npmjs.com/package/@zfadhli/tokrec)
[![CI](https://img.shields.io/github/actions/workflow/status/zfadhli/tokrec/ci.yml?style=flat-square&label=CI)](https://github.com/zfadhli/tokrec/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/@zfadhli/tokrec?style=flat-square)](https://github.com/zfadhli/tokrec/blob/main/LICENSE)

Want the ready-made command-line recorder instead? Use
[`@zfadhli/tokrec-cli`](https://www.npmjs.com/package/@zfadhli/tokrec-cli).

## Install

```bash
bun add @zfadhli/tokrec
# or
npm install @zfadhli/tokrec
```

Built for Bun ≥ 1.2. Nothing in the library is Bun-only — `Bun.which()` is used
when it exists and falls back to a `PATH` search — so the published `dist/`
also runs under Node ≥ 20. **FFmpeg must be on `PATH`** for MP4 conversion,
segmenting, and normalization.

## Quick start

```ts
import { createRecorder } from "@zfadhli/tokrec"

const recorder = createRecorder({
  user: "somebody",
  outputDir: "./recordings",
  interval: 3, // minutes between live-status polls
})

recorder.on("verdict", (v) => console.log("status:", v.reason))
recorder.on("progress", (p) => {
  if (p.kind === "download") console.log(`${p.percent.toFixed(1)}%`)
})
recorder.on("record", (e) => {
  if (e.phase === "end") console.log("saved:", e.file)
})
recorder.on("failure", (err) => console.error(err.code, err.message))

await recorder.start() // polls until offline or stop()
```

`start()` resolves when the run ends; call `stop()` from a signal handler to shut
down gracefully — the download is aborted, buffered data is flushed, and the
partial recording is still remuxed to `.mp4` before the promise settles.

## Configuration

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `user` | `string` | — | TikTok username (required) |
| `outputDir` | `string` | `./recordings` | Destination directory |
| `interval` | `number` | `3` | Minutes between live-status polls |
| `duration` | `number` | `0` (unlimited) | Max recording length in **seconds** |
| `proxy` | `string` | — | HTTP proxy, e.g. `http://127.0.0.1:8080` |
| `cookiesPath` | `string` | `./cookies.json` | Path to a cookies file |
| `cookies` | `CookieAuth` | — | Cookie auth passed as an object instead of a file |
| `logLevel` | `"debug" \| "info" \| "warn" \| "error"` | `info` | Console verbosity |
| `logConsole` | `boolean` | `true` | Set `false` when you render your own output |
| `segmentMinutes` | `number` | `0` (off) | Split the recording into N-minute segments |
| `normalizeAudio` | `boolean` | `false` | EBU R128 loudness normalization via [peaknorm](https://github.com/zfadhli/peaknorm) |
| `normalizeLoudness` | `number` | `-14` | Target loudness in LUFS |
| `normalizeCodec` | `string` | `libopus` | Audio codec for normalized output |
| `normalizeBitrate` | `string` | `96k` | Audio bitrate for normalized output |
| `ratePerSecond` | `number` | `5` | Request cap; `0` disables the limiter |
| `debug` | `boolean` | `false` | API debug logging on stderr |

> The CLI accepts `--duration` in minutes; the library takes seconds.

## Events

Four typed channels:

| Event | Payload | Fires when |
| --- | --- | --- |
| `verdict` | `Verdict` — `reason`, `stream`, `evidence` | Every status poll resolves |
| `record` | `RecordEvent` | Recording lifecycle: `start`, `download`, `segment`, `convert`, `normalize`, `end` |
| `progress` | `ProgressEvent` — `{ kind: "download" }` or `{ kind: "normalize" }` | Bytes/percent updates |
| `failure` | `TikTokError` | A recoverable or fatal error |

`Verdict["reason"]` is one of `live`, `offline`, `restricted`, `no-stream-url`,
`no-room-id`, `error`, and carries the evidence sources that produced it.

## Controller

```ts
interface RecorderController {
  start(): Promise<void>
  stop(): Promise<void> // graceful: joins the active recording first
  getStatus(): RecorderStatus
  on(event, handler): void
  off(event, handler): void
}
```

`RecorderStatus` exposes `state`, `user`, `currentFile`, `sessionDuration`,
`lastPollTime`, and `lastError`.

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `createRecorder(config)` | value | Build a `RecorderController` |
| `TikTokError` | value | Typed error class |
| `isLiveReason(reason)` | value | Narrow a verdict reason |
| `bytesToHuman`, `formatDuration`, `relativeTime`, `sanitizeUser` | value | Formatting helpers used by the CLI |
| `RecorderConfig`, `RecorderController`, `RecorderStatus`, `RecorderEvent`, `RecorderEventHandler`, `RecordEvent`, `ProgressEvent`, `RecordedFile`, `LiveReason`, `Verdict`, `Evidence`, `EvidenceOutcome`, `RoomRef`, `StreamRef`, `SourceId`, `Phase`, `LogLevel`, `TikTokErrorCode` | type | Public types (18) |

Error codes: `config-error`, `ffmpeg-not-found`, `ffmpeg-error`, `aborted`,
`unknown`.

## Output

Recordings are named `<user>=YYYYMMDD_HHMMSS.mp4`; segmenting produces
`<name>_partN.mp4`.

## Links

- [CLI package](https://www.npmjs.com/package/@zfadhli/tokrec-cli)
- [Repository](https://github.com/zfadhli/tokrec) · [Changelog](https://github.com/zfadhli/tokrec/blob/main/CHANGELOG.md)
- [MIT License](https://github.com/zfadhli/tokrec/blob/main/LICENSE)
