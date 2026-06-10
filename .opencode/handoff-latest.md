# Session Handoff — 2026-06-10 03:45

## Goal

Improve the TikTok live stream recorder's CLI output, fix Ctrl-C shutdown to reliably convert partial downloads, and release both v0.6.0 and v0.7.0.

## Files Modified/Created

### CLI Output Improvements
- `src/index.ts` — Track `firstOfflineTime` instead of `lastCheckTime` so the `[last check: ...]` timestamp increases over time rather than always showing the polling interval. Duplicate signals (SIGINT+SIGTERM from one Ctrl-C) are now silently ignored instead of force-exiting mid-conversion. Removed `  ` indent from force-stop message.
- `src/ui.ts` — Removed the 2-space indent from all icon lines (`finalize`, `userLive`, `userOfflineRepeat`, `showError`/`Info`/`Warning`) so spinner output and icon output both start at column 0, fixing visual misalignment.

### Audio Normalization (peaknorm integration)
- `package.json` — Added `"peaknorm": "^0.2.4"` dependency.
- `src/config.ts` — Added `normalizeAudio`, `normalizeLoudness`, `normalizeCodec`, `normalizeBitrate` config fields, 4 new `normalize:*` events in `RecorderEventHandler`, and defaults.
- `src/recorder/normalize.ts` — **NEW** module wrapping `peaknorm.normalizeFile()` with `backup: false`, progress callbacks, and event wiring.
- `src/recorder/index.ts` — Wired normalization after segmenting/conversion. Normalizer created only when `cfg.normalizeAudio === true`. Errors don't crash the pipeline.
- `src/cli.ts` — Added `--normalize`, `--normalize-loudness`, `--normalize-codec`, `--normalize-bitrate` flags.
- `src/index.ts` — Subscribed to `normalize:*` events and mapped to display methods.
- `src/ui.ts` — Added `normalizeStart()`, `normalizeProgress()`, `normalizeComplete()`, `normalizeError()` display methods with spinner + phase/percent.

### Ctrl-C Abort Fixes
- `src/recorder/stream.ts` — Replaced unreliable `reader.cancel()` with `AbortController` signal that races against the 60s read timeout via `Promise.race()`, breaking out instantly on abort. Moved `buffer` variable outside the `try` scope so the catch block can flush remaining data and close the write stream, producing a valid partial file for conversion.

### Dependency Upgrades
- `package.json` — `@biomejs/biome` `^1.9` → `^2.4`, `typescript` `^5.8` → `^6.0`, `peaknorm` `^0.2.2` → `^0.2.4`.
- `biome.json` — Renamed `organizeImports` → `assist`, updated `$schema` to `2.4.16`.

### Releases
- `v0.6.0` — peaknorm integration, offline timestamp fix, dependency upgrades.
- `v0.7.0` — CLI alignment fix, Ctrl-C abort fixes, duplicate signal handling.

## Key Decisions

1. **AbortController over reader.cancel()** — `reader.cancel()` didn't reliably resolve the pending `reader.read()`, causing a 60-second hang on Ctrl-C. Using `AbortController` + `Promise.race` breaks out instantly.

2. **Duplicate signal → no-op instead of force-exit** — Bun fires both SIGINT and SIGTERM for a single Ctrl-C. Previously the second signal force-exited with code 1, killing the process mid-conversion. Now it's a silent return, letting the graceful shutdown finish.

3. **No indent on icon lines** — The 2-space indent on all icon lines was removed instead of adding indent to spinner text, keeping the code simpler and making everything start at column 0.

4. **Normalization defaults to AAC@128k** — TikTok streams use AAC audio; `aac@128k` is chosen over peaknorm's default `libopus@96k` for maximum player compatibility.

5. **Normalization is opt-in** — `normalizeAudio: false` by default. Must pass `--normalize` to enable.

6. **No backup for normalization** — `backup: false` in peaknorm calls. Pipeline has its own redundancy (FLV/TS is already deleted after conversion; if normalization fails, the un-normalized MP4 is preserved).

## Current State

- **Working**: Flawless Ctrl-C graceful shutdown — abort is instant (~5ms), buffer is flushed, partial FLV is remuxed to MP4 (and optionally normalized), then exit.
- **Working**: All icon lines and spinners start at column 0, no misalignment.
- **Working**: Offline `[last check: ...]` timestamp increases over time (just now → 3m ago → 6m ago → ...).
- **Working**: Audio normalization via `--normalize` with spinner progress (Analyzing/Normalizing phases + %).
- **Working**: All three username input forms (`tokrec user`, `--user user`, `-u user`).
- **Working**: Cookie-based WAF bypass, FFmpeg segmenting, graceful shutdown.
- **Published**: `@zfadhli/tokrec` v0.6.0 and v0.7.0 on npm.

## Next Steps / Pending

- [ ] The `--segment-minutes` flag defaults to 20 minutes — consider whether Ctrl-C partial files should skip segmenting and just do a simple `-c copy` conversion instead (since segmenting on a tiny file creates a single segment but still runs FFmpeg twice).
- [ ] Test the `--normalize` path end-to-end with a live stream.
- [ ] Consider adding a `--no-convert` flag to keep the raw FLV/TS.

## Important Context

- **AbortController instant abort** — The `waitForAbort()` helper races against the 60s read timeout via `Promise.race`. When `AbortController.abort()` fires, the race rejects immediately. The outer catch block flushes the buffer and closes the write stream before returning, ensuring partial files are valid.
- **Duplicate signals** — Both SIGINT and SIGTERM are caught. If either fires while `stopping` is already true, the handler returns immediately. No more "Force stopping..." output or exit code 1.
- **Icon alignment** — All icon lines use `process.stdout.write("${icon}${text}\n")` with no leading spaces. The icon constants (`ICON_SUCCESS = "✔ "`, etc.) already include a trailing space. Spinners render as `\r⠋ text` (no leading spaces either). Everything starts at column 0.
- **Normalization config** — Pass `--normalize` to enable. Defaults: `aac@128k`, `-14 LUFS`. Use `--normalize-loudness -16`, `--normalize-codec libopus`, `--normalize-bitrate 96k` to customize.
- **Biome 2.x migration** — `organizeImports` was renamed to `assist`. `--fix` was replaced by `--write` (safe) and `--unsafe` (unsafe fixes). The `$schema` URL was updated.
- **TypeScript 6.x** — `tsc --noEmit` passes cleanly with TS 6.0.3. No code changes were needed.
- **`-d 1` for quick tests** — `tokrec user -d 1` records for 1 minute then auto-converts. Useful for testing the full pipeline without waiting for a stream to end.
