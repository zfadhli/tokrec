# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.2] — 2026-06-15

### Fixed

- **`--no-normalize` now actually disables normalization** — the action handler
  only checked truthiness (`if (opts.normalize)`), so passing `--no-normalize`
  was silently ignored and normalization stayed on (the default). Now the boolean
  value is propagated correctly.
- **Post-processing no longer trusts the pipe byte counter** — the early-return
  guard in `processRecording()` compared `result.size === 0` using the in-memory
  pipe counter, which could diverge from the actual bytes written to disk under
  backpressure or error-recovery paths. Now it reads the real file size from disk
  via `statSync`, so valid recordings are never skipped.

## [0.11.1] — 2026-06-15

### Changed

- **`--normalize` defaults now accurate in docs** — the README's CLI options table
  now correctly shows `on` (not `off`) for `--normalize`, and `libopus`/`96k` for
  the codec/bitrate defaults (matching the actual v0.10.0 behavior).

### Added

- **Version banner shown in README example** — the authentication output example
  now includes the `tokrec v0.X.Y` startup line.

## [0.11.0] — 2026-06-15

### Changed

- **CLI binary renamed from `tiktok-live-recorder` to `tokrec`** — the installed
  binary is now `tokrec` instead of `tiktok-live-recorder`. Update any scripts or
  aliases accordingly.

### Added

- **Version banner at startup** — the CLI now shows `tokrec v0.11.0` as the first
  line of output when running.

## [0.10.0] — 2026-06-14

### Changed

- **Normalize audio now uses peaknorm's defaults (libopus/96k)** — tokrec's
  hardcoded `aac`/`128k` defaults for `--normalize-codec` and
  `--normalize-bitrate` have been removed. When these flags are not
  explicitly provided, peaknorm's own defaults now apply: `libopus` audio
  codec at `96k` bitrate (previously `aac` at `128k`).

## [0.9.1] — 2026-06-14

### Changed

- **Consolidated download modules** — `download-stream.ts` and `download-hls.ts`
  (which were 90% identical) merged into a single `download.ts`. The only difference
  (log message prefix) is now a parameterized `label` argument.
- **Utilities centralized in `utils.ts`** — `findFfmpegPath` and `formatDuration`
  moved from `ffmpeg-utils.ts` to `utils.ts`, making the utility module the single
  source of truth for pure helper functions.
- **Removed `getFfmpegPath()` wrapper** — the orchestrator (`recorder/index.ts`) now
  calls `findFfmpegPath()` directly instead of wrapping it in a one-liner that only
  added an error message.
- **`ffmpeg-utils.ts` scoped to pipe-only** — after extracting general utilities, the
  module now only exports the core `pipeFfmpegSegment` primitive and its associated
  constants. Cleaner separation of concerns.
- **Removed no-op `updateProgress` from Display** — the `updateProgress()` method
  was already a no-op (the recording timer is driven by an independent `setInterval`).
  Removed from the `Display` interface and the event subscription in `index.ts`. The
  `download:progress` event is still available in the recorder's event system for
  API consumers.

## [0.9.0] — 2026-06-14

### Added

- **Recording elapsed timer** — during recording, the spinner now shows a
  live counter that ticks every second (`Recording... [1m 5s]`) instead of
  a static `Recording stream...` message. Elapsed time is now visible from
  the very first second instead of waiting for the first progress event.

### Changed

- **Audio normalization enabled by default** — `--normalize` is no longer
  needed; EBU R128 loudness normalization now runs automatically after
  every conversion. To disable, use `--no-normalize`.

### Fixed

- **Offline status delayed 3 minutes after stream end** — when a live stream
  ended, the recorder waited for the next poll tick (default 3 minutes) before
  reporting `@user is offline`. Now it immediately re-checks via the
  `check_alive` endpoint right after the recording finishes.
- **Misleading `[last check: ...]` label** — the offline repeat message now
  shows `[last online: ...]` instead of `[last check: ...]`, matching what
  the timestamp actually represents.

## [0.8.0] — 2026-06-14

### Added

- **Lightweight live check via `/webcast/room/check_alive/`** — new
  `fetchCheckAlive(roomId)` endpoint returns a tiny boolean response (~100 bytes)
  vs the multi-kilobyte `room/info` response. `isRoomAlive()` uses it as a
  cache-miss fallback. Down from kilobytes to ~100 bytes per check.
- **`--debug` CLI flag** — gates `[API_DEBUG]` log output to stderr for
  troubleshooting without spamming the console by default.
- **Token-bucket rate limiter** — limits API requests to `--rate` per second
  (default 5). Prevents WAF triggering on rapid polling or URL refresh loops.
- **Formal state machine** — validated `setState()` transitions enforce the
  lifecycle: `idle → polling → recording → converting → polling | stopped`.
  Prevents invalid state transitions with clear error messages.
- **`pendingRemuxes` background queue** — the `stop()` method now awaits
  in-flight conversion/segmenting promises with a 60-second timeout, ensuring
  they complete before the process exits.
- **Crash-safe MPEG-TS intermediate format** — switched download output from
  raw FLV to MPEG-TS. TS is fully repair-able and append-friendly. The file
  survives even if FFmpeg is killed mid-write.
- **Segmenting disabled by default** — `segmentMinutes` now defaults to 0
  (disabled). Simple TS→MP4 conversion is the default post-processing path.
- **Cookie source feedback** — startup now logs which cookie source was used
  (`ℹ Firefox cookies loaded` or `ℹ cookies.json loaded`).
- **Auto-exit after `-d` recording** — when a duration limit completes, the
  recorder now exits instead of going back to polling mode.
- **MP4 conversion result shown in terminal** — the `converted` event is now
  wired to the display, showing `✔ Converted: filename.mp4` on success.

### Fixed

- **Slardar WAF bypass** — the HTML page scrape on `www.tiktok.com` was blocked
  by the WAF. The detection now falls through to the `/api-live/user/room/`
  endpoint which is not behind the WAF, using a Firefox TLS fingerprint for
  the HTTP session.
- **`-d` duration limit ignored during long segments** — a single TikTok stream
  URL can stay alive for 90+ seconds. The duration check only ran between
  segments, so `-d 1` could overshoot by 30+ seconds. Fixed by passing
  `-t <remaining>` to FFmpeg for per-segment enforcement.
- **AbortSignal listener memory leak** — each `sleep()` call that used an
  `AbortSignal` added a new `abort` listener but never removed it. Fixed by
  cleaning up the listener in both the resolve and abort paths.
- **Race condition in FFmpeg abort** — `proc.kill()` could lose the race
  against `proc.on("close")`. Replaced with `spawn()` `signal` option which
  guarantees atomic cleanup.
- **Missing abort signal in some FFmpeg spawns** — not all FFmpeg invocations
  received the abort signal, leaving orphaned processes on Ctrl-C. Fixed by
  threading the signal to every spawn call.
- **FFmpeg startup hang** — a bad URL would cause FFmpeg to hang indefinitely.
  Added a 30-second startup timeout that escalates from SIGTERM to SIGKILL.
- **Process signal handlers accumulation** — `process.on("SIGINT", ...)` was
  called multiple times without `process.off()`, causing duplicate handlers.
  Fixed by removing handlers before re-registering.
- **Ctrl-C during recording left `.ts` unconverted** — `stop()` aborted the
  converter signal before awaiting the in-flight tick, so the conversion
  skipped. Reordered `stop()` to let conversion complete first.
- **Memory leak from HTTP client + stream references** — the download loop
  held references to HTTP responses that prevented GC. Fixed by draining and
  destroying stale sockets.

### Changed

- **Download output format: FLV → MPEG-TS** — FFMpeg now writes MPEG-TS
  (`-f mpegts`) instead of raw FLV. The `.ts` file is crash-safe: even if
  FFmpeg is killed mid-write, all data before the last complete TS packet is
  valid and playable.
- **Default segmenting disabled** — `segmentMinutes` defaults to 0. Existing
  users who rely on segmenting should pass `-s 20` (or their preferred value).
- **Architectural refactoring** — the monolithic `recorder.ts` was split into
  9 focused files under `src/recorder/`. Shared utilities were extracted to
  `ffmpeg-utils.ts`. No behavioral changes.
- **Dependency bumps** — various dependencies updated to latest versions.

## [0.7.1] — 2026-06-10

### Fixed

- **Ctrl-C graceful shutdown now converts partial downloads** — `reader.cancel()`
  was unreliable at resolving the pending read, causing a 60-second hang on
  Ctrl-C. Replaced with `AbortController` + `Promise.race` for instant abort
  (~5ms). The download catch block now flushes the in-memory buffer and closes
  the write stream so the partial FLV is valid for FFmpeg conversion.
- **Duplicate signals no longer force-exit mid-conversion** — Bun fires both
  SIGINT and SIGTERM for a single Ctrl-C. The second signal is now silently
  ignored instead of calling `process.exit(1)`, letting the graceful shutdown
  pipeline (abort → flush → convert → exit) finish.
- **Offline `[last check: ...]` timestamp now increases over time** — the
  elapsed time was incorrectly measured from the previous poll tick instead of
  from the first offline detection, so it always showed the polling interval
  (e.g. always `3m ago`) rather than growing (`3m ago` → `6m ago` → ...).

### Changed

- **CLI output alignment** — removed the 2-space indent from all icon lines so
  spinners and icons both start at column 0, fixing visual misalignment.

## [0.7.0] — 2026-06-10

### Added

- **Audio normalization via peaknorm** — new `--normalize` flag applies EBU R128
  two-pass loudness normalization using `peaknorm`. Configurable target loudness
  (`--normalize-loudness`), audio codec (`--normalize-codec`), and bitrate
  (`--normalize-bitrate`). Runs after conversion/segmenting on each MP4 file
  sequentially with a live progress spinner (Analyzing / Normalizing phases).

### Fixed

- **Offline timestamp not updating** — the `[last check: ...]` timestamp now
  correctly measures elapsed time from the first offline detection instead of
  from the previous poll tick, so it shows an increasing duration (e.g. `3m ago`
  → `6m ago` → `9m ago`) rather than always displaying the polling interval.

### Changed

- **Dependency upgrades** — TypeScript 5.9 → 6.0, Biome 1.9 → 2.4,
  peaknorm 0.2.2 → 0.2.4.

## [0.6.0] — 2026-06-10

### Changed

- **CLI output — repeated offline messages suppressed** — the `tick` handler
  now tracks the last known live state and only prints `@user is offline` on
  the first detection or when transitioning from live → offline. Subsequent
  offline ticks update the same line in-place with a `[last check: ...]`
  relative timestamp (e.g. `3m ago`) using ANSI escape sequences, eliminating
  the flood of repeated "is offline" lines during long offline periods.

## [0.5.0] — 2026-06-10

### Added

- **HLS (.m3u8) stream support** — TikTok returns both FLV and HLS stream URLs.
  The recorder now detects HLS playlists and downloads them via FFmpeg directly
  (which handles the M3U8 playlist + .ts segments natively). FLV remains the
  preferred format (lower latency); HLS is used as a fallback.
- **Fixture-based test suite** — 17 new tests covering the full live detection
  chain (Tier 1/2/3), Firefox cookie extraction, INI parsing, and SQLite cookie
  queries. Uses real captured TikTok HTML/API responses as fixtures.

### Changed

- **`fetchRoomInfoFromApi` (room/enter endpoint) removed** — The Webcast
  `/webcast/room/enter/` endpoint frequently returns 403 errors, even when
  the user is live. All lookups now go through the reliable `/webcast/room/info/`
  endpoint (`fetchRoomInfoFromRoomApi`), which works for both live (status=2)
  and offline (status=4) rooms.
- **`findStreamUrlRecursively` now prefers FLV over HLS** — When both formats
  exist in the response, FLV URLs are collected first and returned preferentially.

### Fixed

- **Stream URL extraction for room/info API** — The `extractStreamUrlFast`
  function now falls back to `main.hls` when `main.flv` is absent at a given
  quality level, covering edge cases where FLV URLs are missing.

## [0.4.2] — 2026-06-09

### Fixed

- **Support TikTok's new page structure** — TikTok migrated from `SIGI_STATE`
  to `__UNIVERSAL_DATA_FOR_REHYDRATION__` for embedding page data. The `/live`
  page no longer contains room info, causing all users to be reported as
  offline. Fixed by extracting the numeric user ID from the profile page's
  `webapp.user-detail` and using the Webcast API (`/room/info/`) for live
  status and stream URL.
- **Webcast API cookie propagation** — cookies are now seeded for
  `webcast.tiktok.com` and `m.tiktok.com` in addition to `www.tiktok.com`,
  fixing 403 errors from the Webcast API.

## [0.4.1] — 2026-06-09

### Fixed

- **Segment file timestamps now reflect recording time** — each MP4 segment's
  file modification time is set to the approximate time that segment was
  recorded, so segments appear in correct playback order when sorted by date
  in a file manager.
- **Segment numbering starts from `_part1`** — the `-segment_start_number 1`
  FFmpeg flag changes the output pattern so the first segment is named
  `username=20260609_171234_part1.mp4` instead of `_part0.mp4`.

## [0.4.0] — 2026-06-09

### Added

- **Auto-detect TikTok cookies from Firefox** — the tool now automatically
  reads `sessionid_ss` and `tt-target-idc` from Firefox's cookie store
  (`~/.mozilla/firefox/*/cookies.sqlite`) using bun:sqlite. Falls back to
  `cookies.json` if Firefox isn't available or no TikTok login session is
  found. No CLI flags, no config changes, no extra dependencies required.

## [0.3.1] — 2026-06-09

### Fixed

- **False-offline detection** — when TikTok asynchronously loads room info,
  `LiveRoom.liveRoomUserInfo` could be absent from SIGI_STATE, causing the tool
  to incorrectly report a live user as offline. Added a three-tier fallback:
  `UserModule.users[user].roomId` for the room ID, `LiveRoom.liveRoomStatus`
  for live status, and Webcast API (`room/enter/` and `room/info/`) as the final
  resort for stream URL extraction.
- **TypeScript `process` global not found** — `tsconfig.json` was missing the
  `"types": ["bun"]` field, so VS Code and standalone `tsc` could not resolve
  Bun-provided Node.js globals without installing `@types/node`.

## [0.3.0] — 2026-06-09

### Added

- **Positional username** — `tokrec vierstinrovve` now works in addition to
  `--user vierstinrovve` and `-u vierstinrovve`. The first bare argument is
  treated as the TikTok username.
- **Comprehensive README** — full documentation covering CLI options, library
  API, authentication setup, pipeline architecture, event system, FAQ, and
  troubleshooting.

### Changed

- **Version source of truth** — the CLI tool now reads its version dynamically
  from `package.json` via `pkg.version`, instead of a hardcoded string. One
  less thing to update on release.

## [0.2.1] — 2026-06-09

### Changed

- **Package renamed** — `tiktok-live-recorder-bun` → `@zfadhli/tokrec` for npm publishing
  under the `@zfadhli` scope. Binary name stays `tiktok-live-recorder`.
- **Publish via GitHub Actions** — the `publish.yml` workflow now runs `npm publish
  --provenance --access public` on `v*` tags, using the `NPM_TOKEN` secret. Provenance
  attestation is enabled for supply-chain transparency.

## [0.2.0] — 2026-06-09

### Added

- **Terminal Display Manager** (`src/ui.ts`) — replaces cluttered `[TIMESTAMP] [LEVEL]`
  console output with a beautiful spinner-driven terminal UI using koko-cli's
  `createSpinner`, `ICON_*`, and `color` utilities.
- **Live progress during recording** — spinner shows current bytes downloaded, elapsed
  time, and download speed (e.g. `150.2 MB • 1m 23s • 1.8 MB/s`), updated every second.
- **Automatic stream reconnection** — TikTok stream segments are short-lived (30-60s).
  When one ends, the downloader transparently fetches a fresh URL and continues writing
  to the same file. `--duration` limits work correctly across reconnections.
- **Reconnection safety limits** — max 100 reconnects per recording session prevents
  infinite loops if TikTok returns endless redirects.
- **New recorder events** — `checking`, `download:progress`, `download:end`,
  `segmenting:start`, `segmenting:end`, `converting:start` for fine-grained lifecycle
  tracking.
- **`logConsole` config option** — set `false` to suppress internal logger console output
  (used automatically by the CLI when the Display is active).

### Changed

- **CLI output** — replaced all `[INFO]`/`[WARN]`/`[ERROR]` log lines with clean
  one-liners using ✔/✘/⚠/ℹ icons and colored text. File logs remain fully detailed with
  timestamps and levels for debugging.
- **Logger `console` option** — `createLogger()` now accepts `console: boolean` (default
  `true`). When `false`, writes to file only, allowing the Display to own the terminal.
- **Stream downloader signature** — `download()` accepts an optional `getNextUrl`
  callback and `ProgressInfo` callback. Existing callers using 4 params continue to work.

### Fixed

- **Premature end of recording** — TikTok delivers live streams as short FLV segments
  (30-60s). Previously, the downloader stopped at the end of the first segment and
  waited 3+ minutes for the next poll. Now it reconnects transparently and keeps
  recording to the same file.
- **Spinner/label interleaving** — the internal logger was writing to stdout while the
  Display was also using the terminal, causing raw `[INFO]` lines between spinner
  frames. Now the Display is the sole owner of stdout/stderr in CLI mode.

## [0.1.1] — 2026-06-09

### Changed

- **Split into library + CLI dual entry point** — `createRecorder` and all types are
  now exported from the package entry (`'tiktok-live-recorder-bun'`), while the CLI
  is available at `'tiktok-live-recorder-bun/cli'`. The `tiktok-live-recorder` binary
  continues to work unchanged.

## [0.1.0] — 2026-06-09

### Added

- **SIGI_STATE HTML scraping** — extract room ID, live status, and stream URLs from the
  TikTok profile page's embedded JSON. No Webcast API dependency needed.
- **Recursive stream URL search** — brute-force FLV/HLS URL search across the entire
  SIGI_STATE JSON, surviving TikTok key name or nesting structure changes.
- **JSON string parsing in recursive search** — handles nested JSON-encoded fields (like
  `stream_data`) by recursively parsing and searching inside them.
- **All quality key fallback** — tries `origin`, `fhd`, `uhd`, `hd`, `sd`, `ld` quality
  keys instead of only `hd`/`ld`.
- **Webcast API fallback** — when SIGI_STATE lacks stream data (async-loaded room info),
  falls back to `/webcast/room/info/?aid=1988` with recursive search on the response.
- **Cookie-based auth seeding** — seeds TikTok session cookies into the HTTP session jar
  via `session.setCookie()` for authenticated requests.
- **Chrome TLS fingerprint impersonation** — uses `wreq-js` with `chrome_142` profile
  to bypass basic bot detection.
- **Automatic polling mode** — polls every N minutes (configurable, default 5), records
  when user goes live.
- **Custom recording duration** — `--duration` flag to stop recording after N seconds.
- **Custom output directory** — `--output` flag for recording destination.
- **FLV → MP4 auto-conversion** — spawns FFmpeg with stream copy (`-c copy`, no re-encode)
  after recording completes, deletes the original FLV.
- **HTTP proxy support** — `--proxy` flag for regional restriction bypass.
- **Rotating log files** — 5 MB rotating file logger (3 backups) + color console output.
- **Graceful shutdown** — Ctrl-C aborts download, flushes buffer, converts to MP4, and
  cleans up. Second Ctrl-C force-terminates.
- **35 automated tests** — covering CLI parsing, config validation, logger, recursive
  search edge cases (deep nesting, JSON strings, arrays, quality key variants).

### Fixed

- **WAF blocking bypass** — TikTok's Slardar WAF blocked unauthenticated requests.
  Fixed by seeding cookies into the session via `setCookie()` instead of sending a
  one-off `Cookie` header that wasn't persisted.
- **Deadlock on Ctrl-C during recording** — `monitor.stop()` waited for the in-flight
  tick but never awaited `currentTick` because the promise wasn't assigned. Fixed by
  properly tracking the tick promise and awaiting it in `stop()`.
- **Stream download not aborting on Ctrl-C** — `reader.read()` blocked indefinitely
  even after `abortFlag` was set. Fixed by calling `reader.cancel()` in `abort()`.
- **No timeout on HTTP requests** — `session.fetch()` hung forever on hanging
  connections. Fixed by adding `AbortSignal.timeout(15000)` to all requests.
- **Network errors crashing the tick loop** — `fetchLiveInfo` now returns `null` on
  timeout/error instead of throwing, so the tick handler cleanly logs "offline".
