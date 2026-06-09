# Session Handoff — 2026-06-09 15:30

## Goal

Transform the TikTok live stream recorder from a bare-bones CLI with cluttered `[TIMESTAMP] [LEVEL]` logs into a polished tool with beautiful terminal output, reliable stream reconnection, and published to npm as `@zfadhli/tokrec`.

## Files Modified/Created

### New Files
- `src/ui.ts` — Terminal Display Manager using koko-cli's `createSpinner`, `ICON_*`, and `color`. Methods: `checkingUser()`, `userLive()`, `userOffline()`, `startRecording()`, `updateProgress()`, `finishRecording()`, `startSegmenting()`, `segmentsCreated()`, `startConverting()`, `conversionDone()`, `showError()`, `showInfo()`, `showWarning()`, `stop()`.
- `README.md` — Comprehensive documentation: CLI reference, library API, authentication setup, pipeline architecture, event system, FAQ, troubleshooting.

### Core Library
- `src/config.ts` — Added event types: `checking`, `download:progress`, `download:end`, `segmenting:start`, `segmenting:end`, `converting:start`. Added `logConsole` option to `RecorderConfig` (default `true`, `false` suppresses console output from internal logger).
- `src/logger.ts` — Added `console?: boolean` option to `createLogger()` (default `true`). When `false`, skips stdout/stderr but still writes to file.
- `src/utils.ts` — Unchanged.

### CLI
- `src/index.ts` — Rewired to use `Display` instead of bare `logger.info()`. Sets `config.logConsole = false` to suppress internal logger. Subscribes to all recorder events and maps them to `display.*()` calls.
- `src/cli.ts` — Added `extractPositional()` helper to accept username as first positional arg (`tokrec username`). Now reads version dynamically from `package.json` via `pkg.version`. Error messages mention both positional and `--user` forms.

### Recording Pipeline
- `src/recorder/stream.ts` — Added `ProgressInfo` interface, `onProgress` callback to `download()`, `getNextUrl` callback for reconnection. On `done: true` or read timeout (60s), calls `tryReconnect()` which fetches a fresh stream URL and continues writing to the same file (max 100 reconnects). Progress is throttled to ~1s intervals.
- `src/recorder/index.ts` — Wires `onProgress` → `download:progress` event, `getNextUrl` callback that re-checks live status via `invalidateCache()` + `getRoomId()` + `getLiveUrl()`. Emits `checking`, `download:end`, `segmenting:start`, `segmenting:end`, `converting:start` events. Includes `roomId` in `tick` event payload.
- `src/recorder/convert.ts` — Unchanged.

### DevOps
- `package.json` — Renamed from `tiktok-live-recorder-bun` to `@zfadhli/tokrec`. Version bumped from `0.1.1` → `0.2.0` → `0.2.1` → `0.3.0`. Added `publishConfig.access`, `repository`, `bugs`, `homepage`. Fixed `main`/`exports`/`bin` from `.js` to `.mjs`.
- `.github/workflows/publish.yml` — Added `id-token: write` permission, `actions/setup-node@v4`, `npm publish --provenance --access public` step. Triggers on `v*` tags.
- `CHANGELOG.md` — Sections for v0.2.0, v0.2.1, v0.3.0.

### Tests
- `test/logger.test.ts` — Added test for `console: false` still writes to file.
- `test/cli.test.ts` — All existing tests pass (positional + `--user`/`-u` forms).

## Key Decisions

1. **Display owns the terminal, not the logger** — The `src/ui.ts` module is the sole writer to stdout/stderr in CLI mode. The internal `createRecorder()` logger defaults to `console: true` (for library consumers), but the CLI sets `logConsole: false` so the Display's spinners/icons don't interleave with raw `[INFO]` lines.

2. **Stream reconnection, not HLS handling** — TikTok's live FLV segments are short-lived (30-60s). Rather than switching to HLS (.m3u8), the downloader transparently reconnects to fresh FLV URLs and writes to the same file. A `getNextUrl` callback (provided by the orchestrator) re-checks live status via the API cache-invalidate pattern. Limited to 100 reconnects per session.

3. **`npm publish --provenance` — requires repository field** — npm's Sigstore provenance attestation requires `package.json` to have a `repository.url` matching the GitHub repo. The publish workflow needs `id-token: write` permission and `actions/setup-node` with `registry-url`. Using `NODE_AUTH_TOKEN` (not `npm config set`) is the idiomatic GitHub Actions pattern.

4. **Dynamic version from `package.json`** — `src/cli.ts` imports `pkg from '../package.json'` and uses `pkg.version` instead of a hardcoded string. Bun and `tsdown` handle JSON imports natively; no import assertions needed.

5. **Positional username via argv preprocessing** — `cac`'s default command (`command('')`) doesn't support positionals. Instead of switching to a subcommand pattern, `extractPositional()` scans `argv` for the first bare argument (skipping flags and their values) and injects `--user`. This keeps backward compatibility with `--user`/`-u`.

## Current State

- **Working**: Beautiful spinner-driven terminal output (checking, recording progress with bytes/time/speed, segmenting, converting, errors)
- **Working**: All three username formats: `tokrec user`, `tokrec --user user`, `tokrec -u user`
- **Working**: Automatic stream reconnection when TikTok segments end (tested live)
- **Working**: Cookie-based WAF bypass via `cookies.json`
- **Working**: FFmpeg segmenting into configurable-length MP4 segments (default 20 min)
- **Working**: Graceful shutdown (SIGINT, SIGTERM, SIGHUP)
- **Working**: Configurable recording duration, polling interval, proxy, log level
- **Working**: npm publish via GitHub Actions with Sigstore provenance
- **Working**: CLI version matches package.json dynamically
- **Published**: `@zfadhli/tokrec` v0.3.0 on npm
- **Uploaded**: Comprehensive README on GitHub

## Next Steps / Pending

- [ ] The `fix/publish-action` remote branch still exists on GitHub (`origin/fix/publish-action`) — it can be cleaned up
- [ ] Test Webcast API fallback (`aid=1988`) with a live user — SIGI_STATE primary path works but the fallback hasn't been tested end-to-end
- [ ] The `stream_data` field is sometimes absent from SIGI_STATE even when user is live (async-loaded room info) — verify Webcast API catches this
- [ ] Consider handling HLS (`.m3u8`) streams if TikTok returns those instead of FLV

## Important Context

- **WAF bypass requires valid cookies** — Without `sessionid_ss` in `cookies.json`, TikTok's Slardar WAF returns a 1155-byte challenge page instead of the real profile page. The tool will report "offline" for any user.
- **wreq-js cookie jar** — `session.fetch()` with a `Cookie` header does NOT populate the session's internal cookie jar. Always use `session.setCookie(name, value, url)`.
- **FFmpeg required** — Required for both simple FLV→MP4 conversion AND segmenting. Must be on `$PATH`.
- **`--duration` vs `--segment-minutes`** — Both accept minutes. `--duration` limits total recording time. `--segment-minutes` controls each MP4 segment's length. After the stream ends, `ffmpeg -c copy -f segment` splits the FLV using `-segment_time`.
- **`invalidateCache()`** — Must be called at the start of each poll tick to ensure fresh SIGI_STATE data from TikTok. Also called in `getNextUrl()` before re-checking live status.
- **Read timeout** — The `timeout()` helper in `stream.ts` wraps `reader.read()` with a 60s deadline. On timeout, the catch block tries to reconnect via `getNextUrl()`. If reconnection fails, it returns whatever data was buffered.
- **Signal handling** — `SIGINT`, `SIGTERM`, and `SIGHUP` all trigger the same graceful shutdown: show shutdown message → abort download → reader.cancel → return partial data → FFmpeg segment → cleanup display → exit.
- **Display auto-start in `updateProgress`** — removed in the final version. The recording spinner must be started by `startRecording()` before `updateProgress()` can update it. This prevents spinner re-creation during shutdown.
- **npm publish config** — `--provenance` requires `repository.url` in `package.json` matching the GitHub repo. The workflow uses `actions/setup-node@v4` with `registry-url` + `NODE_AUTH_TOKEN`. The `NPM_TOKEN` secret must be a valid npm automation token with publish access to the `@zfadhli` scope.
- **tsdown outputs `.mjs`** — The build tool `tsdown` outputs ESM files with `.mjs` extension. The `package.json` `main`, `exports`, and `bin` fields must point to `.mjs` files, not `.js`.
