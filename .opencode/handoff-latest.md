# Session Handoff — 2026-06-14 22:46

## Goal

Fix 3 UX issues reported during live usage: (1) offline status taking 3 minutes to appear after a stream ends, (2) confusing "last check" wording in the offline display, and (3) lack of a live recording timer during downloads. Also enabled audio normalization by default and published v0.9.0.

## Files Modified/Created

| File | Summary of changes |
|---|---|
| `src/recorder/index.ts` | **Immediate offline re-check after recording** — after `processRecording()` completes, if not in one-shot mode (`-d`) and not a user-initiated stop (Ctrl+C), calls `api.isRoomAlive(roomId)` via the lightweight `check_alive` endpoint and emits `tick: { isLive: false }` if the stream is dead. Eliminates the 3-minute delay before "offline" appears. |
| `src/ui.ts` | **Live recording timer** — replaced static "Recording stream..." spinner with a 1-second `setInterval` that displays `Recording... [0s]`, `Recording... [1s]`, etc., ticking up in real time. `updateProgress()` is now a no-op (timer runs independently). Removed now-unused `fmtBytes` and `fmtSpeed` helpers. Also renamed `[last check: ...]` → `[last online: ...]` in `userOfflineRepeat()`. |
| `src/config.ts` | **Audio normalization enabled by default** — `normalizeAudio` default flipped from `false` to `true`. Users no longer need `--normalize`; pass `--no-normalize` to disable. |
| `CHANGELOG.md` | Added v0.9.0 section (Added: recording timer, Changed: normalize default, Fixed: offline delay + "last check" wording). |
| `package.json` | Version bumped 0.8.0 → 0.9.0. |

## Key Decisions

1. **`isRoomAlive` over `getRoomId` for post-recording check** — After a recording finishes, the roomId from the just-ended session is still in scope. Using `isRoomAlive(roomId)` hits the lightweight `check_alive` endpoint (~100 bytes) instead of the full `room/info` round-trip. Edge case: if the user starts a *new* livestream with a different roomId immediately, `isRoomAlive(oldRoomId)` returns false, but the next poll tick (3 min) picks up the new room. This is extremely unlikely and acceptable.

2. **`setInterval`-based timer independent of progress events** — Download progress events can arrive irregularly (every 2-10s depending on segment size). A 1-second `setInterval` in the UI layer keeps the elapsed timer smooth and immediate from t=0. The timer is cleaned up in `clearSpinner()` so it never leaks across state transitions.

3. **Audio normalization on by default** — EBU R128 normalization via `peaknorm` is fast (stream copy for video, two-pass audio analysis) and produces consistently loud outputs across different streams. Prior behavior required an explicit `--normalize` flag which most users didn't know about. The existing event/display flow already shows "Normalizing audio..." / "✔ Audio normalized" messages, so no UI changes were needed.

## Current State

### Working
- **Immediate offline detection** — after a stream ends, `@user is offline` appears right after `✔ Converted: filename.mp4` instead of 3 minutes later
- **Recording timer** — spinner shows `Recording... [1m 5s]` starting from 0s, updating every second
- **"last online"** — offline repeat message now reads `[last online: 9m ago]` instead of `[last check: 9m ago]`
- **Normalize enabled by default** — every conversion now runs audio normalization; output shows `Normalizing audio...` / `✔ Audio normalized`
- All 66 tests pass, clean `tsc --noEmit`
- v0.9.0 published on npm + GitHub release
- CHANGELOG updated

### Detection flow
```
fetchLiveInfo(user)
  ├─ tryFetchPage (www.tiktok.com → m.tiktok.com)
  │    └─ WAF blocks both → API fallback
  ├─ /api-live/user/room/ (WAF bypass)
  │    └─ Returns roomId + status (2=live, 4=offline)
  └─ If live → /webcast/room/info/ for stream URL

isRoomAlive(roomId)
  ├─ Cache hit → return cached.isLive
  └─ Cache miss → /webcast/room/check_alive/ → boolean
```

### Recording display flow
```
⠧ Recording... [0s]              ← immediate, ticks every 1s
⠧ Recording... [1m 5s]
✔ Recording finished file.ts — 14.7 MB in 58s
⠧ Converting to MP4...
⠧ Normalizing audio...
✔ Audio normalized
✔ Converted: file.mp4
ℹ @user is offline                ← immediate, no 3-min wait
```

## Next Steps / Pending

- [ ] **No pending items** — all reported issues from this session are resolved and released in v0.9.0.

## Important Context

- **`room/check_alive/` endpoint**: `https://webcast.tiktok.com/webcast/room/check_alive/?aid=1988&region=CH&room_ids={roomId}&user_is_login=true`. Not behind WAF. Response is `{ "data": [{ "alive": boolean, "room_id": string }] }`. ~100 bytes vs KB for `room/info`.

- **`stopRequested` guard**: The immediate post-recording re-check checks `!stopRequested` to avoid running during a Ctrl+C shutdown. When the user presses Ctrl+C, `recorder.stop()` sets `stopRequested = true`, aborts the downloader, calls `monitor.stop()`, and tears down. The re-check is skipped in this path.

- **`isRoomAlive` cache**: The `isRoomAlive()` function caches results by roomId. The post-recording check calls it fresh (cache may still hold the previous "alive" value — but the stream just ended, so `check_alive` should return false and update the cache).

- **Normalizer dependency**: `peaknorm` package. Installed automatically. Uses EBU R128 two-pass loudness normalization. Configurable via `--normalize-loudness`, `--normalize-codec`, `--normalize-bitrate`.

- **Monitor pattern**: `createPollingMonitor` has `stop()` (aborts + awaits current tick) and `stopAfterCurrentTick()` (flag checked after next tick). The recording timer `setInterval` is cleaned up via `clearSpinner()` which is called by `finalize()` on every state transition.

- **Timer no `updateProgress`**: The `updateProgress()` method is now intentionally a no-op since the interval handles the timer. The `Display` interface still declares it for API compatibility with the recorder events.

- **Package**: `@zfadhli/tokrec` v0.9.0 on npm. GitHub release: https://github.com/zfadhli/tokrec/releases/tag/v0.9.0

- **TikTok WAF**: The Slardar WAF on `www.tiktok.com` blocks HTML page requests from non-browser clients. The `/api-live/user/room/` and `/webcast/room/*` API endpoints are not behind the WAF. The HTTP client uses `wreq-js` for TLS fingerprinting.

- **RoomIds are per-session**: The roomId changes each time the user goes live. Do NOT hardcode roomIds.
