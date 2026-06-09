# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
