# Session Handoff — 2026-06-09 08:35

## Goal

Build a minimal, lean Bun + TypeScript version of the TikTok Live Recorder Python project
(https://github.com/Michele0303/tiktok-live-recorder) with function-based Composition API style,
zero runtime deps (except wreq-js for TLS fingerprinting), and CLI + library dual entry point.

## Files Modified/Created

### Core library (`src/`)
- `src/lib.ts` **created** — Library entry point; exports `createRecorder` + all types
- `src/config.ts` — `RecorderConfig`, `RecorderController`, `RecorderStatus`, `TikTokError`, `AppErrorKind` types + normalization/validation
- `src/api/client.ts` — `createHttpClient()` — wraps wreq-js `createSession()` with cookie seeding via `setCookie()`, 15s `AbortSignal.timeout`
- `src/api/tiktok.ts` — `createTikTokApi()` — SIGI_STATE HTML scraping (primary) → recursive FLV URL search → Webcast API fallback (`/webcast/room/info/?aid=1988`)
- `src/recorder/stream.ts` — `createStreamDownloader()` — FLV download with 512KB buffer, reader.cancel() on abort for immediate shutdown
- `src/recorder/convert.ts` — `createConverter()` — `Bun.spawn(['ffmpeg', '-c', 'copy'])`, deletes FLV on success
- `src/recorder/index.ts` — `createRecorder()` — orchestrator wiring API + monitor + downloader + converter into `{ start, stop, getStatus, on }`
- `src/monitor.ts` — `createPollingMonitor()` — interval-based tick loop with proper `currentTick` tracking for stop()
- `src/logger.ts` — `createLogger()` — rotating file logger (5MB, 3 backups) + color console

### CLI (`src/`)
- `src/cli.ts` — Rewritten from manual `Bun.argv` to `@zfadhli/koko-cli` `createCLI()` wrapping `cac`
- `src/index.ts` — Entry point with signal handlers (SIGINT/SIGTERM), graceful shutdown, uses `color.red()` from koko-cli

### Config & Build
- `package.json` — Dependencies: `wreq-js` (TLS fingerprinting), `@zfadhli/koko-cli` (CLI framework). Exports map for lib + CLI
- `tsdown.config.ts` — Builds both `src/lib.ts` and `src/index.ts`
- `tsconfig.json` — TypeScript strict mode, ESNext, bundler resolution
- `biome.json` — Lint + format config, semicolons as-needed, single quotes
- `CHANGELOG.md` — Keep a Changelog format (v0.1.0, v0.1.1)

### CI/CD & Release
- `.github/workflows/ci.yml` — Build + test on push/PR
- `.github/workflows/publish.yml` — GitHub release on tag

### Tests
- `test/config.test.ts` — Config normalization + validation (6 tests)
- `test/cli.test.ts` — CLI arg parsing (11 tests)
- `test/logger.test.ts` — Logger file output + level filtering (2 tests)
- `test/utils.test.ts` — `formatFilename`, `sanitizeUser`, `bytesToHuman` (4 tests)
- `test/tiktok.test.ts` — `findStreamUrlRecursively` recursive search (9 tests)
- **35 tests total, all passing**

## Key Decisions

1. **SIGI_STATE HTML scraping as primary** — Instead of relying on TikTok's Webcast API (which requires request signing), extract room ID, live status, and stream URLs from the `<script id="SIGI_STATE">` JSON embedded in `tiktok.com/@user/live`. Webcast API is fallback only.

2. **Recursive stream URL search** — Brute-force searches the entire SIGI_STATE JSON for any `.flv` or `.m3u8` URL, plus parses JSON-encoded strings (e.g. `stream_data`) and recurses into them. Survives TikTok renaming keys.

3. **wreq-js for TLS fingerprinting** — Uses `createSession({ browser: 'chrome_142' })` to impersonate Chrome. Critical lesson: `Cookie` header does NOT populate session jar — must use `session.setCookie()`.

4. **15-second request timeout** — Uses `AbortSignal.timeout(15000)` on all `session.fetch()` calls to prevent hanging.

5. **Proper abort → convert → stop sequence** — `stop()` calls `downloader.abort()` → `reader.cancel()` first, then `monitor.stop()`, so the in-flight tick finishes (flush buffer → convert to MP4) before cleanup.

6. **Lib + CLI split** — `src/lib.ts` exports `createRecorder` + types for programmatic use; `src/index.ts` is the CLI wrapper. Exports map in package.json supports both `'.'` and `'./cli'`.

7. **koko-cli for CLI framework** — Replaced manual `Bun.argv` parsing with `@zfadhli/koko-cli` (wraps `cac`). Provides auto-generated `--help`, `--version`, and `color` functions.

## Current State

- **Working**: Full recording pipeline — detect live → get FLV URL → download with buffering → convert to MP4 via FFmpeg → delete FLV
- **Working**: Automatic polling mode with configurable interval
- **Working**: Cookie-based auth (`cookies.json` with `sessionid_ss`) bypasses TikTok WAF
- **Working**: Graceful Ctrl-C with immediate abort and conversion
- **Working**: 15s timeout on all HTTP requests
- **Working**: Recursive stream URL search handles JSON-encoded strings and all quality keys
- **Working**: Lib + CLI dual entry, koko-cli CLI framework
- **Working**: 35 tests across 5 files, all passing
- **Working**: CI (build + test on push/PR) and publish (GitHub release on tag) workflows
- **Working**: Two tagged releases (v0.1.0, v0.1.1) with auto-generated release notes

## Next Steps / Pending

- [ ] Test Webcast API fallback with a live user (SIGI_STATE primary path is working but the `aid=1988` fallback hasn't been tested end-to-end while live)
- [ ] The `stream_data` field is sometimes absent from SIGI_STATE even when user is live (async-loaded room info) — need to verify Webcast API fallback catches this
- [ ] Consider adding `createSpinner` or `createProgress` from koko-cli for better download UX (currently uses static `[INFO]` logs)
- [ ] Consider handling HLS (`.m3u8`) streams if TikTok ever returns those instead of FLV
- [ ] Consider adding `--cookies` flag support to koko-cli option set (currently reads from `./cookies.json` only)

## Important Context

- **WAF bypass requires valid cookies** — Without `sessionid_ss` in `cookies.json`, TikTok's Slardar WAF returns a 1155-byte challenge page instead of the real profile page. The tool will report "offline" for any user.
- **wreq-js cookie jar** — `session.fetch()` with a `Cookie` header does NOT populate the session's internal cookie jar. Always use `session.setCookie(name, value, url)`.
- **FFmpeg required** — The converter spawns `ffmpeg` as a subprocess. Must be installed on `$PATH`.
- **`TikTokError` class** — Tagged error with `kind: AppErrorKind` — used for all expected errors. Network errors return `null` instead of throwing (logged as "offline").
- **Recursive search exported** — `findStreamUrlRecursively` is exported from `src/api/tiktok.ts` for testing purposes.
- **`invalidateCache()`** — Must be called at the start of each poll tick to ensure fresh SIGI_STATE data.
- **Nested JSON string parsing** — The recursive search handles `stream_data` (a JSON string) by parsing it and recursing inside. This is critical because `stream_data.data.hd.main.flv` contains the actual URL.
