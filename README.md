<div align="center">

# tokrec

**Minimal TikTok live stream recorder — Bun + TypeScript**

[![CI Status](https://img.shields.io/github/actions/workflow/status/zfadhli/tokrec/ci.yml?style=flat-square&label=CI)](https://github.com/zfadhli/tokrec/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@zfadhli/tokrec?style=flat-square)](https://www.npmjs.com/package/@zfadhli/tokrec)
[![npm downloads](https://img.shields.io/npm/dw/@zfadhli/tokrec?style=flat-square)](https://www.npmjs.com/package/@zfadhli/tokrec)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.2-14151a?style=flat-square&logo=bun)](https://bun.sh)
[![License](https://img.shields.io/npm/l/@zfadhli/tokrec?style=flat-square)](LICENSE)

[Features](#features) · [Installation](#installation) · [Quick start](#quick-start) · [CLI options](#cli-options) · [Authentication](#authentication) · [How it works](#how-it-works) · [Library API](#library-api) · [FAQ](#faq)

</div>

`tokrec` polls a TikTok user's live status, detects when they go live, downloads the stream, and post-processes it with FFmpeg into playable MP4 segments. Available as both a CLI tool and a TypeScript library.

> [!NOTE]
> This is **not** an all-in-one TikTok downloader. It focuses on **live stream recording** with automatic reconnection, graceful shutdown, and clean terminal output. For downloading uploaded videos, see other tools.

---

## Features

- **Automatic polling** — checks every N minutes (default 3) and starts recording as soon as the user goes live
- **Stream reconnection** — TikTok stream segments are short-lived (30-60s). When one ends, `tokrec` transparently fetches a fresh URL and continues writing to the same file
- **Duration-limited recording** — record for a fixed time (`-d`) and auto-exit, or record indefinitely (default)
- **Time-aligned MP4 segments** — post-recording, optionally split the stream into configurable-length MP4 segments, each independently playable
- **Audio normalization** — EBU R128 two-pass loudness normalization via [peaknorm](https://github.com/sinedied/peaknorm)
- **Graceful shutdown** — responds to `SIGINT`/`SIGTERM`/`SIGHUP`. Aborts the download, flushes buffered data, converts to MP4, and exits cleanly
- **Firefox cookie auto-detection** — reads `sessionid_ss` from Firefox's SQLite cookie store automatically (no config file needed)
- **Live progress display** — animated spinner with real-time byte count, elapsed time, and download speed
- **Typed event system** — 15 events with typed payloads for lifecycle tracking
- **Proxy support** — route traffic through an HTTP proxy for regional access
- **FLV + HLS support** — automatically detects and handles both stream formats
- **68+ passing tests** — unit tests with real TikTok HTML/API fixtures

---

## Requirements

- **FFmpeg** — must be on your `$PATH` for MP4 conversion and segmenting
  - Linux: `apt install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: `choco install ffmpeg`
- **Bun** (optional, for development) — Node.js 20+ can run the built package

---

## Installation

### CLI tool (global)

```bash
npm install -g @zfadhli/tokrec
```

Then run:

```bash
tokrec -u username
```

### One-off use (npx)

```bash
npx @zfadhli/tokrec -u username
```

### As a library

```bash
npm install @zfadhli/tokrec
```

```ts
import { createRecorder } from '@zfadhli/tokrec'

const recorder = createRecorder({ user: 'username' })
recorder.on('recording:end', (info) => console.log('Done:', info.file))
await recorder.start()
```

> [!TIP]
> When using as a library, logs print to the console by default. To suppress console output (e.g., if you run your own UI), set `logConsole: false` in the config.

---

## Quick start

```bash
# Record a live stream (Ctrl+C to stop)
tokrec -u username

# Record for 10 minutes, then exit
tokrec -u username -d 10

# Record for 10 minutes, split into 5-minute segments
tokrec -u username -d 10 -s 5

# Use a proxy and custom output directory
tokrec -u username -o ./videos -p http://127.0.0.1:8080

# Enable audio normalization
tokrec -u username --normalize
```

> [!TIP]
> Both `-d` and `-s` accept values in **minutes** (the tool converts them internally).

---

## CLI options

| Option | Shorthand | Default | Description |
|--------|-----------|---------|-------------|
| `--user <name>` | `-u` | _(required)_ | TikTok username (with or without `@`) |
| `--output <dir>` | `-o` | `./recordings` | Output directory |
| `--interval <minutes>` | `-i` | `3` | Polling interval (min 1) |
| `--duration <minutes>` | `-d` | unlimited | Max recording duration. Implies one-shot (exit after recording) |
| `--segment-minutes <minutes>` | `-s` | disabled | Split recording into MP4 segments of this length |
| `--proxy <url>` | `-p` | none | HTTP proxy URL |
| `--cookies <path>` | `-c` | `./cookies.json` | Path to cookies JSON file |
| `--log-level <level>` | `-l` | `info` | One of: `debug`, `info`, `warn`, `error` |
| `--normalize` | _(none)_ | on | Enable EBU R128 audio normalization (enabled by default, pass `--no-normalize` to disable) |
| `--normalize-loudness <num>` | _(none)_ | `-14` | Target loudness in LUFS |
| `--normalize-codec <name>` | _(none)_ | `libopus` | Audio codec for normalized output (peaknorm default) |
| `--normalize-bitrate <str>` | _(none)_ | `96k` | Audio bitrate for normalized output (peaknorm default) |
| `--rate <n>` | _(none)_ | `5` | Max API requests/sec (0 = unlimited). Prevents WAF triggering |
| `--debug` | _(none)_ | off | Show API debug logging on stderr |

---

## Authentication

TikTok's Slardar WAF blocks unauthenticated requests. You must provide a valid `sessionid_ss` cookie to bypass it.

### Option 1: Firefox (auto-detected)

If you're logged into TikTok in Firefox, `tokrec` automatically reads the cookie from Firefox's SQLite store. No config file needed.

```bash
tokrec -u username
```

You will see:
```
tokrec v0.11.0
ℹ Firefox cookies loaded (30 cookies)
```

### Option 2: cookies.json

1. Open TikTok in any browser and log in.
2. Open DevTools → **Application** → **Cookies** → `www.tiktok.com`.
3. Copy the value of `sessionid_ss` and create a `cookies.json` file:

```json
{
  "sessionid_ss": "6c74daa215a8f34eeddf5162ca091668"
}
```

You can also include the `tt-target-idc` cookie (optional, for regional routing):

```json
{
  "sessionid_ss": "6c74daa215a8f34eeddf5162ca091668",
  "tt-target-idc": "useast2a"
}
```

4. Place `cookies.json` in the working directory (auto-detected) or pass `--cookies ./path/to/cookies.json`.

> [!CAUTION]
> Without valid cookies, the tool will report every user as **offline** because the WAF challenge page won't contain live-stream JSON data.

---

## How it works

### Detection flow

```
fetchLiveInfo(user)
  ├─ tryFetchPage (www.tiktok.com → m.tiktok.com)
  │    └─ WAF blocks both → API fallback
  ├─ /api-live/user/room/ (bypasses WAF)
  │    └─ Returns roomId + status (2=live, 4=offline)
  └─ If live → /webcast/room/info/ for stream URL

isRoomAlive(roomId)  [during recording]
  ├─ Cache hit → return cached.isLive
  └─ Cache miss → /webcast/room/check_alive/ → boolean (~100 bytes)

getNextUrl()  [during recording]
  ├─ isRoomAlive(roomId) → if dead, stop
  ├─ Invalidate cache
  └─ getLiveUrl(roomId) → fresh stream URL
```

### Pipeline

```
┌────────────┐   ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐
│  Poll tick  │ → │  Detect live │ → │  Download TS  │ → │  FFmpeg post    │
│  (every Nm) │   │  3-tier      │   │  (auto-reconn.)│   │  (convert/      │
│             │   │  fallback    │   │               │   │   segment)       │
└────────────┘   └──────────────┘   └──────────────┘   └─────────────────┘
```

1. **Poll tick** — every N minutes, the monitor calls the check function.
2. **Live detection** — uses a three-tier fallback:
   - Fast-path from `SIGI_STATE` on the `/live` page (~95% of cases)
   - Brute-force recursive search of the entire JSON (survives key name changes)
   - Webcast API fallback (`/webcast/room/info/`)
3. **Download** — the stream is downloaded via FFmpeg stdout pipe to a `.ts` file. TikTok's short-lived URLs are handled transparently: when a URL expires, `getNextUrl()` fetches a fresh one. Duration limit is enforced **inside** FFmpeg via the `-t` flag for precise cutoff.
4. **Post-processing** — the `.ts` file is remuxed to MP4 via `ffmpeg -c copy` (no re-encode, fast). If segmenting is enabled, FFmpeg's segment muxer splits into `_partN.mp4` files. Audio normalization runs last if enabled.

### Output structure

```
./recordings/
  username=20260614_143000.ts               # raw download (deleted after conversion)
  username=20260614_143000.mp4              # remuxed MP4 (no segmenting)
  username=20260614_143000_part1.mp4        # segment 1 (with -s)
  username=20260614_143000_part2.mp4        # segment 2
  ...
```

File naming: `{username}={YYYYMMDD}_{HHMMSS}[_partN].mp4`

### Event system

The recorder emits typed events that you can subscribe to via `recorder.on()`:

| Event | Payload | When |
|-------|---------|------|
| `checking` | `{ user }` | Before each poll tick |
| `tick` | `{ user, isLive, roomId? }` | After checking live status |
| `recording:start` | `{ user, file }` | When recording begins |
| `download:progress` | `{ bytes, elapsed, speed }` | During download (~1s intervals) |
| `download:end` | `{ file, duration, size }` | When download completes |
| `recording:end` | `{ file, duration, size }` | Per segment/file after conversion |
| `segmenting:start` | `{ input, outputPattern }` | Before FFmpeg segmenting |
| `segmenting:end` | `{ segments }` | After segmenting |
| `converting:start` | `{ input }` | Before simple conversion |
| `converted` | `{ input, output }` | After each converted file |
| `normalize:start` | `{ file }` | Before audio normalization |
| `normalize:progress` | `{ file, percent, phase }` | During normalization |
| `normalize:end` | `{ input, output }` | After normalization |
| `normalize:error` | `{ input, error }` | On normalization error |
| `error` | `err: TikTokError` | On non-fatal errors |

---

## Library API

### `createRecorder(config)`

```ts
import { createRecorder } from '@zfadhli/tokrec'
import type { RecorderConfig, RecorderController, RecorderEvent } from '@zfadhli/tokrec'

const recorder: RecorderController = createRecorder({
  user: 'username',          // required
  outputDir: './videos',     // default: './recordings'
  interval: 3,               // polling interval in minutes
  duration: 600,             // max recording duration in seconds
  segmentMinutes: 20,        // segment length in minutes
  proxy: 'http://127.0.0.1:8080',
  cookies: { sessionid_ss: '...' },
  logLevel: 'info',
  logConsole: true,
})
```

### `RecorderController`

```ts
interface RecorderController {
  start(): Promise<void>
  stop(): Promise<void>
  getStatus(): RecorderStatus
  on<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void
  off<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void
}
```

### `RecorderStatus`

```ts
interface RecorderStatus {
  state: 'idle' | 'polling' | 'recording' | 'converting' | 'stopped'
  user: string
  currentFile?: string
  sessionDuration?: number
  lastPollTime?: string
  lastError?: string
}
```

### Example: build a notification bot

```ts
import { createRecorder } from '@zfadhli/tokrec'

const recorder = createRecorder({ user: 'username' })

recorder.on('checking', ({ user }) => console.log(`Checking @${user}...`))
recorder.on('tick', ({ isLive, roomId, user }) => {
  if (isLive) {
    console.log(`@${user} is LIVE! (room: ${roomId})`)
    // Send a Discord/Telegram notification here
  }
})
recorder.on('recording:end', ({ file, duration }) => {
  console.log(`Recorded ${file} (${Math.round(duration)}s)`)
})
recorder.on('error', (err) => console.error(`[${err.kind}] ${err.message}`))

await recorder.start()
```

---

## FAQ

### Why does the tool say "offline" for every user?

You likely don't have a valid `sessionid_ss` cookie. See the [Authentication](#authentication) section.

### Why does the download stop after 30 seconds?

TikTok serves live streams as short FLV segments (~30-60s). `tokrec` handles reconnection transparently — this is expected behavior and the download continues with a fresh URL.

### Can I record multiple users at once?

Run multiple instances of the CLI in separate terminals, each with a different `--user` and `--output`.

### Can I use this with Node.js instead of Bun?

Yes. The package is built to ESM for Node.js 20+. Bun is optional for development.

### Where are the log files?

`tiktok-recorder.log` in the working directory, with rotating backups. Console output is also available via `--log-level`.

### Does it work if the user goes live while I'm not running it?

No. `tokrec` only polls while it's running. If you want 24/7 monitoring, leave it running in a background process (e.g., tmux, systemd, or a Docker container).

---

## Troubleshooting

### FFmpeg not found

Install FFmpeg and ensure it is on your `$PATH`:

```bash
which ffmpeg    # should print a path
```

### "WAF blocked" errors

Your `sessionid_ss` cookie has expired or is invalid. Generate a fresh one from your browser's DevTools.

### The process doesn't exit after a `-d` recording

Make sure you're using v0.7.1 or later. Earlier versions continued polling instead of exiting.
