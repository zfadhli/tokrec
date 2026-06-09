<div align="center">

# tokrec

**Minimal TikTok live stream recorder — Bun + TypeScript**

<br>

[![CI Status](https://img.shields.io/github/actions/workflow/status/zfadhli/tokrec/ci.yml?style=flat-square&label=CI)](https://github.com/zfadhli/tokrec/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@zfadhli/tokrec?style=flat-square)](https://www.npmjs.com/package/@zfadhli/tokrec)
[![npm downloads](https://img.shields.io/npm/dw/@zfadhli/tokrec?style=flat-square)](https://www.npmjs.com/package/@zfadhli/tokrec)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.2-14151a?style=flat-square&logo=bun)](https://bun.sh)
[![License](https://img.shields.io/npm/l/@zfadhli/tokrec?style=flat-square)](LICENSE)

[CLI options](#cli-options) · [Features](#features) · [Installation](#installation) · [Quick start](#quick-start) · [Authentication](#authentication) · [How it works](#how-it-works) · [Library API](#library-api) · [FAQ](#faq)

</div>

`tokrec` polls a TikTok user's live status, detects when they go live, downloads the FLV stream, and post-processes it with FFmpeg into playable MP4 segments. It is available as both a CLI tool and a TypeScript library.

> [!NOTE]
> This is **not** an all-in-one TikTok downloader. It focuses on **live stream recording** with automatic reconnection, graceful shutdown, and clean terminal output. For downloading uploaded videos, see other tools.

---

## Features

- **Automatic polling** — checks every N minutes (default 3) and starts recording as soon as the user goes live.
- **Stream reconnection** — TikTok stream segments are short-lived (30–60s). When one ends, `tokrec` transparently fetches a fresh URL and continues writing to the same file.
- **Time-aligned MP4 segments** — post-recording, FFmpeg splits the raw FLV into configurable-length MP4 segments (default 20 minutes), each independently playable.
- **Graceful shutdown** — responds to `SIGINT`, `SIGTERM`, and `SIGHUP` (terminal close). Aborts the current download, flushes buffered data, runs FFmpeg, and exits cleanly. A second signal force-kills.
- **Live progress display** — animated spinner with real-time byte count, elapsed time, and download speed. Built with [@zfadhli/koko-cli](https://github.com/zfadhli/koko-cli).
- **Cookie-based auth** — seeds a `sessionid_ss` cookie into the HTTP session for authenticated requests, bypassing TikTok's Slardar WAF.
- **Duration limit** — record for a fixed time (`--duration`) or unlimited (default).
- **Proxy support** — route traffic through an HTTP proxy for regional access.
- **Dual entry** — use as a CLI tool or embed `createRecorder()` in your own application.
- **45+ passing tests** — unit-tested CLI parsing, config validation, stream URL detection, and logger.

---

## Installation

### CLI tool (global)

```bash
npm install -g @zfadhli/tokrec
```

Then run with:

```bash
tiktok-live-recorder -u username
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

## Requirements

- **FFmpeg** — must be on your `$PATH` for FLV→MP4 conversion and segmenting.
  - Linux: `apt install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: `choco install ffmpeg`
- **Bun** (optional, for development) — Node.js 20+ can run the built package.

---

## Quick start

```bash
# Record a live stream (Ctrl+C to stop)
tiktok-live-recorder -u vierstinrovve

# Record for 10 minutes, split into 5-minute segments
tiktok-live-recorder -u vierstinrovve -d 10 -s 5

# Use a proxy and custom output directory
tiktok-live-recorder -u vierstinrovve -o ./videos -p http://127.0.0.1:8080

# Specify a cookies file (see Authentication section)
tiktok-live-recorder -u vierstinrovve -c ./my-cookies.json
```

---

## CLI options

| Option | Shorthand | Default | Description |
|--------|-----------|---------|-------------|
| `--user <name>` | `-u` | _(required)_ | TikTok username (without `@`) |
| `--output <dir>` | `-o` | `./recordings` | Output directory for recordings |
| `--interval <minutes>` | `-i` | `3` | Polling interval (minimum 1) |
| `--duration <minutes>` | `-d` | unlimited | Maximum recording duration |
| `--segment-minutes <minutes>` | `-s` | `20` | Length of each output MP4 segment |
| `--proxy <url>` | `-p` | none | HTTP proxy URL |
| `--cookies <path>` | `-c` | `./cookies.json` | Path to cookies JSON file |
| `--log-level <level>` | `-l` | `info` | One of: `debug`, `info`, `warn`, `error` |

> [!TIP]
> `--duration` and `--segment-minutes` both accept values in **minutes**. The tool converts them internally.

---

## Authentication

TikTok's Slardar WAF blocks unauthenticated requests. You must provide a valid `sessionid_ss` cookie to bypass it.

### Setup

1. Open TikTok in your browser and log in.
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

4. Run the tool with `--cookies ./path/to/cookies.json`, or place `cookies.json` in the working directory (auto-detected).

> [!CAUTION]
> Without valid cookies, the tool will report every user as **offline** because the WAF challenge page won't contain live-stream JSON data.

---

## How it works

### Pipeline

```
┌────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Poll tick  │ → │  Detect live  │ → │  Download FLV │ → │  FFmpeg post  │
│  (every Nm) │   │  via SIGI_    │   │  (auto-reconn.)│   │  (segment/    │
│             │   │  STATE scrape │   │               │   │   convert)    │
└────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

1. **Poll tick** — every N minutes, the monitor calls the check function.
2. **Live detection** — the TikTok profile page is fetched and the `SIGI_STATE` JSON blob is extracted. Stream URL extraction follows a three-tier fallback:
   - Fast-path from the known `pull_data.stream_data` location (~95% of cases).
   - Brute-force recursive search of the entire JSON (survives key name changes).
   - Webcast API fallback (`/webcast/room/info/?aid=1988`).
3. **Download** — the raw FLV is streamed to disk with a 512 KB buffer and 60-second read timeout. If the stream segment ends, the downloader fetches a fresh URL and continues (up to 100 reconnects per session). The `--duration` limit is checked against total elapsed time across reconnections.
4. **FFmpeg post-processing** — the FLV is split into time-aligned MP4 segments using `ffmpeg -c copy -f segment -segment_time N -reset_timestamps 1`. If segmenting fails, it falls back to a simple FLV→MP4 conversion.

### Event system

The recorder emits typed events that you can subscribe to via `recorder.on()`:

| Event | Payload | When |
|-------|---------|------|
| `checking` | `{ user }` | Before each poll tick |
| `tick` | `{ user, isLive, roomId? }` | After checking live status |
| `recording:start` | `{ user, file }` | When recording begins |
| `download:progress` | `{ bytes, elapsed, speed }` | During download (~1s intervals) |
| `download:end` | `{ file, duration, size }` | When download completes |
| `segmenting:start` | `{ input, outputPattern }` | Before FFmpeg segmenting |
| `segmenting:end` | `{ segments }` | After segmenting |
| `converting:start` | `{ input }` | Before simple conversion |
| `converted` | `{ input, output }` | After each segment/file |
| `error` | `err: TikTokError` | On non-fatal errors |

### Output structure

Recordings are saved as:

```
./recordings/
  vierstinrovve=20260609_143000.flv              # raw download (deleted after conversion)
  vierstinrovve=20260609_143000_part1.mp4        # segment 1
  vierstinrovve=20260609_143000_part2.mp4        # segment 2
  ...
```

File naming: `{username}={YYYYMMDD}_{HHMMSS}[_partN].mp4`

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

### Example: watch for live status

```ts
import { createRecorder } from '@zfadhli/tokrec'

const recorder = createRecorder({ user: 'username' })

recorder.on('checking', ({ user }) => console.log(`Checking @${user}...`))
recorder.on('tick', ({ isLive, roomId, user }) => {
  console.log(isLive ? `@${user} is LIVE!` : `@${user} is offline`)
})

recorder.on('error', (err) => console.error(`[${err.kind}] ${err.message}`))

await recorder.start()
```

---

## FAQ

### Why does the tool say "offline" for every user?

You likely don't have a valid `sessionid_ss` cookie. See the [Authentication](#authentication) section.

### Why does the download stop after 30 seconds?

TikTok serves live streams as short FLV segments (~30–60s). The tool now reconnects automatically, but older versions stopped after one segment. Update to the latest version.

### Can I record multiple users at the same time?

Run multiple instances of the CLI in separate terminals, each with a different `--user` and `--output`.

### Can I use this with Node.js instead of Bun?

The package is built to ESM for Node.js 20+. The runtime dependency is `@zfadhli/koko-cli` and `wreq-js`, both of which work in Node. Bun is optional for development.

### Where are the log files?

`tiktok-recorder.log` in the working directory, with rotating backups. File logs include full timestamps and levels for debugging.

---

## Troubleshooting

### FFmpeg not found

Install FFmpeg and ensure it is on your `$PATH`:

```bash
which ffmpeg    # should print a path
```

### "WAF blocked" errors

Your `sessionid_ss` cookie has expired or is invalid. Generate a fresh one from your browser's DevTools.

### The spinner freezes during download

The download has a 60-second read timeout. If TikTok stops sending data (e.g., network drop), the tool waits 60 seconds before attempting reconnection. If reconnection fails, the download ends with whatever data was buffered.
