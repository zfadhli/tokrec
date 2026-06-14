# Session Handoff — 2026-06-14 11:52

## Goal

Transform the `@zfadhli/tokrec` codebase from a working-but-leaky v0.7.1 into a well-architected, memory-safe, production-quality codebase. The session was organized as a series of improvement passes inspired by two external codebases (tokwatchr, Michele0303/tiktok-live-recorder) and culminated in a formal `/deepen` architectural review.

## Files Modified/Created

### New modules (created during session)

| File | Purpose |
|---|---|
| `src/recorder/download-stream.ts` | FLV/stream download via FFmpeg stdout pipe (was `download-flv.ts`) |
| `src/recorder/download-hls.ts` | HLS download via FFmpeg with URL refresh support |
| `src/recorder/ffmpeg-utils.ts` | Shared `findFfmpegPath()`, `formatDuration()`, `FFMPEG_STARTUP_TIMEOUT` |
| `src/recorder/post-processing.ts` | Extracted segmenting + conversion pipeline from orchestrator |
| `src/recorder/recorder-events.ts` | Typed event emitter (on/off/emit/clear) |
| `src/recorder/recorder-state.ts` | State machine with transition validation |
| `docs/tokwatchr-stream-comparison.md` | Architecture comparison with tokwatchr |
| `docs/michele0303-stream-comparison.md` | Architecture comparison with Michele0303 |

### Existing files modified

| File | Summary of changes |
|---|---|
| `src/recorder/index.ts` | Shrank from 472→234 lines. Extracted events/state/post-processing. Uses `findFfmpegPath()` from `ffmpeg-utils`. |
| `src/recorder/stream.ts` | Shrank from 431→88 lines. Routes to `downloadFlv`/`downloadHls`. |
| `src/recorder/convert.ts` | Removed duplicate `findFfmpeg()`. Uses `findFfmpegPath()`. Uses `TikTokError` instead of plain `Error`. |
| `src/config.ts` | Added `"ffmpeg-error"` and `"aborted"` to `AppErrorKind`. |
| `src/api/client.ts` | Reduced `as any` casts from 5→2. Only `body as any` and `as unknown as Response` remain. |
| `src/api/tiktok.ts` | Extracted shared `fetchFromRoomApi<T>()` eliminating ~70% duplication between `fetchRoomInfoFromRoomApi` and `fetchStreamUrlFromApi`. |
| `src/index.ts` | Added `process.off()` cleanup for signal handlers. Added `.catch()` on `main()`. |
| `src/recorder/post-processing.ts` | Fixed `stopRequested` staleness bug (boolean → getter). |
| `package.json` | Bumped 5 deps to latest: peaknorm 0.5.1, wreq-js 2.3.1, biome 2.5.0, tsdown 0.22.2, typescript 6.0.3. |

## Key Decisions

1. **FFmpeg for FLV download** — Replaced the fetch()+reader+buffer+tryReconnect JS loop with FFmpeg stdout pipe + `-reconnect` flags + simple outer URL refresh loop. FFmpeg handles HTTP reconnection transparently. (Tokwatchr-inspired)

2. **Crash-safe MPEG-TS output** — Switched intermediate download format from FLV to MPEG-TS. TS is append-friendly and playable mid-write. The converter already handles `.ts` input. (Tokwatchr-inspired)

3. **Single `AbortController` propagated everywhere** — All async operations receive `AbortSignal` explicitly. `spawn()` uses the built-in `signal` option instead of manual `proc.kill()`. Synchronous `signal?.aborted` checks in close handlers prevent race conditions. (Tokwatchr v0.4.3 fix)

4. **`pendingRemuxes` queue** — Array of promises for in-flight conversions/normalizations. `stop()` waits up to 60s via `Promise.allSettled()` before killing, so near-complete work isn't lost on Ctrl-C. (Tokwatchr-inspired)

5. **SIGKILL escalation** — All SIGTERM kills (startup timeout, max duration) escalate to SIGKILL after 2s grace period to prevent orphaned zombie processes.

6. **State machine with validation** — `TRANSITIONS` map enforces valid state transitions. Invalid transitions are logged and ignored. `lastPollTime` and `lastError` auto-tracked.

7. **Error type normalization** — All FFmpeg modules (`convert.ts`, `download-flv.ts`, `download-hls.ts`) now throw `TikTokError` with discriminable `kind` instead of plain `Error`.

8. **God file split** — `stream.ts` (431 lines) split into 4 modules (stream + download-stream + download-hls + ffmpeg-utils). `index.ts` (472 lines) split into 4 modules (index + recorder-events + recorder-state + post-processing). No file exceeds 234 lines.

## Current State

### Working (fully tested, 62/62 tests pass, tsc clean)
- FLV download via FFmpeg stdout pipe with `-reconnect` flags + URL refresh loop
- HLS download via FFmpeg stdout pipe with `-reconnect` flags + URL refresh (new, matches FLV)
- AbortController-based cancellation with spawn `signal` option across all 3 FFmpeg spawn sites
- Synchronous `signal?.aborted` check in all close handlers (no race)
- `AbortError` swallowed in all error handlers
- `AbortSignal.timeout(15000)` replaced with manual `setTimeout` + `AbortController` in HTTP client
- `pendingRemuxes` — in-flight conversions finish within 60s on abort
- FFmpeg startup timeout (30s) at all spawn sites
- SIGKILL escalation (2s after SIGTERM) at all kill sites
- Formal state machine with validated transitions
- Typed event emitter with `off()` + `clear()`
- `process.on("SIGINT/SIGTERM/SIGHUP")` cleaned up via `process.off()` on exit
- `eventHandlers` Map cleared on `stop()`
- `console.log` removed from library code (only in CLI and doc comments)
- Biome config migrated to 2.5.0
- All dependencies at latest compatible versions
- Comparison docs written for both tokwatchr and Michele0303

### Architecture (after god file split)
```
src/recorder/
├── index.ts              # 234 lines — orchestrator shell + start/stop
├── stream.ts             #  88 lines — types + factory + URL routing
├── download-stream.ts    # 172 lines — FLV stdout pipe download
├── download-hls.ts       # 172 lines — HLS FFmpeg download + URL refresh
├── post-processing.ts    # 218 lines — segmenting + conversion pipeline
├── recorder-events.ts    #  54 lines — typed event emitter
├── recorder-state.ts     #  52 lines — state machine with validation
├── ffmpeg-utils.ts       #  34 lines — findFfmpegPath + formatDuration
├── convert.ts            # 114 lines — FLV/TS → MP4 conversion
└── normalize.ts          #  63 lines — audio normalization
```

## Next Steps / Pending

- [ ] Consider extracting shared `runFfmpegLoop` pattern from `download-flv.ts` and `download-hls.ts` — they now share ~80% of their structure (stdout pipe, backpressure, startup timeout, outer loop). A shared utility would reduce duplication.
- [ ] Consider adding Chrome/Chromium cookie extraction to `browser-cookies.ts` (currently Firefox-only).
- [ ] Add rate limiting to TikTok API calls to prevent WAF triggering on rapid polling.
- [ ] Rename `download-flv.ts` comment header (still says "FLV stream downloader" but outputs MPEG-TS).
- [ ] The `runFallbackConversion` function in `post-processing.ts` duplicates ~20 lines with `processConversion`. Consider extracting a shared helper.
- [ ] Consider adding `AbortError`-aware `sleep()` that accepts an `AbortSignal` (for the orphaned timer in `Promise.race`).

## Important Context

- **FFmpeg required for ALL downloads now** — FLV path was changed from fetch() to FFmpeg. Previously only HLS and post-processing required FFmpeg. Error messages include installation instructions.
- **Intermediate format is MPEG-TS (.ts)** — Not FLV. All paths write `.ts` during download, then convert to `.mp4` via `-c copy`.
- **`_run.js` pattern** — All `TikTokError` instances use a discriminable `kind` field from `AppErrorKind`. Callers should `instanceof TikTokError` and switch on `err.kind`.
- **AbortController ownership** — `createStreamDownloader` owns its own `AbortController` (for downloads). `createRecorder` owns `stopAbortController` (for segmenting/conversion). Both are replaced on each `start()` call.
- **`pendingRemuxes` lifecycle** — Array is reset in `start()`, populated during segmenting/conversion, cleared after `Promise.race` in `stop()`.
- **`stopRequested` is a getter** — Changed from `boolean` to `() => boolean` in `ProcessingDeps` to prevent stale reads during async operations.
- **`-d 1` for quick tests** — `tokrec user -d 1` records 1 minute then auto-converts. Useful for testing the full pipeline.
- **Event handler cleanup** — `recorder.on()` handlers are cleared by `emitter.clear()` in `stop()`. No accumulation across start/stop cycles.
- **Published:** `@zfadhli/tokrec` v0.7.1 on npm.
