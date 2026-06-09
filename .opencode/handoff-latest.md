# Session Handoff — 2026-06-09 09:45

## Goal

Build a robust TikTok live stream recorder in Bun + TypeScript that handles:
- Long recordings by segmenting into 20-min chunks (via FFmpeg post-processing, not manual FLV splitting)
- Network drops (60s read timeout, auto-recover on next poll)
- Accidental terminal close (SIGHUP handler)
- Clean CLI UX with shorthand options and consistent units

## Files Modified/Created

### Core Library
- `src/config.ts` — Added `cookiesPath`, `segmentMinutes` fields; changed interval default 5→3
- `src/utils.ts` — `formatFilename()` now uses `{user}={date}_{time}_part{part}.flv` format (e.g. `vierstinrovve=20260609_171234_part1.flv`)

### Recording Pipeline
- `src/recorder/stream.ts` — Single-file FLV download with 512KB buffer, 60s read timeout (`timeout()` helper), `writer.end()` for proper flush, abort support
- `src/recorder/convert.ts` — Unchanged (FLV→MP4 via FFmpeg `-c copy`)
- `src/recorder/index.ts` — Orchestrator: download raw FLV → FFmpeg segment muxer splits into timed MP4 segments (`-f segment -segment_time N -reset_timestamps 1`). Falls back to simple conversion if segmenting fails. Scans output dir for generated `_partN.mp4` files.

### CLI
- `src/cli.ts` — All 7 options have shorthand aliases: `-u`, `-o`, `-i`, `-d`, `-p`, `-l`, `-c`, `-s`; `--duration` accepts minutes (multiplied by 60 internally)
- `src/index.ts` — Added `SIGHUP` handler for terminal close

### Tests
- `test/cli.test.ts` — 7 shorthand tests + `--duration` minutes→seconds conversion
- `test/config.test.ts` — Updated interval default from 5→3
- `test/utils.test.ts` — Updated regex patterns for new filename format

## Key Decisions

1. **FFmpeg handles segmenting, not manual FLV splitting** — Manual splitting at arbitrary byte positions produces invalid FLV files (missing header, mid-tag data). Instead, download the whole stream as raw FLV, then use `ffmpeg -i input.flv -c copy -f segment -segment_time N -reset_timestamps 1 output_part%d.mp4`. This produces valid, playable MP4 segments because FFmpeg properly parses FLV tag boundaries.

2. **`writer.end()` over `writer.close()`** — `close()` doesn't wait for pending writes; `end()` flushes all buffered data to disk before the promise resolves. Critical for preventing FFmpeg from seeing truncated files on disk.

3. **60-second read timeout** — `reader.read()` can hang forever if TCP connection drops silently. A `timeout()` helper races a timer against each read. On timeout, the partial FLV is returned, FFmpeg segments what it can, and the polling loop continues checking for live.

4. **`--duration` in minutes (CLI), seconds (internal)** — Users type `--duration 5` for 5 minutes; the CLI action multiplies by 60 and stores seconds in config. Consistent with `--interval` which also uses minutes.

5. **Filename format** — `username=20250609_143000_part1.flv`. Compact date/time (no separators), `_partN` suffix. The `formatFilename()` utility accepts an optional `part` parameter.

## Current State

- **Working**: Full recording pipeline — detect live → download FLV → FFmpeg segment → MP4 segments
- **Working**: Cookie-based auth via `cookies.json` (with `sessionid_ss`)
- **Working**: Graceful shutdown on SIGINT, SIGTERM, SIGHUP (terminal close)
- **Working**: 60s read timeout on stream download, auto-recover on next poll tick
- **Working**: Segment duration configurable via `-s`/`--segment-minutes` (default 20)
- **Working**: Lib + CLI dual entry, koko-cli CLI framework with shorthand options
- **Working**: 44 tests across 5 files, all passing
- **Known limitation**: If FFmpeg segmentation fails (e.g. truncated FLV from network drop), the raw FLV is kept as fallback but no MP4 is produced for that session

## Next Steps / Pending

- [ ] Test Webcast API fallback (`aid=1988`) with a live user — SIGI_STATE primary path works but the fallback hasn't been tested end-to-end
- [ ] The `stream_data` field is sometimes absent from SIGI_STATE even when user is live (async-loaded room info) — verify Webcast API catches this
- [ ] Consider adding `createSpinner`/`createProgress` from koko-cli for better download UX (currently static `[INFO]` logs)
- [ ] Consider handling HLS (`.m3u8`) streams if TikTok returns those instead of FLV

## Important Context

- **WAF bypass requires valid cookies** — Without `sessionid_ss` in `cookies.json`, TikTok's Slardar WAF returns a 1155-byte challenge page instead of the real profile page. The tool will report "offline" for any user.
- **wreq-js cookie jar** — `session.fetch()` with a `Cookie` header does NOT populate the session's internal cookie jar. Always use `session.setCookie(name, value, url)`.
- **FFmpeg required** — Required for both simple FLV→MP4 conversion AND segmenting. Must be on `$PATH`.
- **`--duration` vs `--segment-minutes`** — `--duration` limits total recording time (in minutes, converted to seconds internally). `--segment-minutes` controls each segment's length (default 20, also in minutes). After the stream ends, `ffmpeg -c copy -f segment` splits the FLV using `-segment_time`.
- **`invalidateCache()`** — Must be called at the start of each poll tick to ensure fresh SIGI_STATE data from TikTok.
- **Read timeout** — The `timeout()` helper in `stream.ts` wraps `reader.read()` with a 60s deadline. On timeout, the catch block aborts and returns whatever data was buffered. The orchestrator's onTick resumes polling on the next interval.
- **Signal handling** — `SIGINT`, `SIGTERM`, and `SIGHUP` all trigger the same graceful shutdown: abort download → reader.cancel → return partial data → FFmpeg segment → exit.
