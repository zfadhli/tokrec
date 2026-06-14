# Session Handoff — 2026-06-14 20:57

## Goal

Resume from the previous session's pending items: fix the busy 1-second polling loop in `monitor.ts` with `AbortError`-aware `sleep()`, and implement the `/webcast/room/check_alive/` endpoint for faster/cheaper live checks (as tokdl does).

## Files Modified/Created

| File | Summary of changes |
|---|---|
| `src/monitor.ts` | Replaced `active` flag + 1s polling loop with `AbortController` (`stopSignal`). `stop()` calls `stopSignal.abort()` to immediately interrupt `sleep(intervalMs, signal)`, making stop responsive instantly instead of waiting up to 1s. |
| `src/api/tiktok.ts` | Added `fetchCheckAlive(roomId)` — calls `/webcast/room/check_alive/` endpoint returning a simple boolean (`data[0].alive`). Updated `isRoomAlive()` to use it instead of re-fetching full `LiveInfo` (cache still checked first). |
| `src/recorder/index.ts` | `getNextUrl()` now calls `api.isRoomAlive(roomId)` (uses `check_alive`) first; only invalidates cache + fetches stream URL if still alive. Avoids full page re-scan during recording. |
| `test/fixtures/tiktok/check-alive-live.json` | **New** — Fixture: `{ data: [{ alive: true, room_id: "..." }] }`. |
| `test/fixtures/tiktok/check-alive-offline.json` | **New** — Fixture: `{ data: [{ alive: false, room_id: "..." }] }`. |
| `test/tiktok-api.test.ts` | Added 4 tests for `isRoomAlive` with `check_alive` (live, offline, HTTP error, cache hit). |
| `.opencode/handoff-latest.md` | Updated by biome `--write --unsafe` formatting pass. |

## Key Decisions

1. **`room/check_alive/` over `room/info/` for alive checks** — The `check_alive` endpoint returns a tiny boolean response (~100 bytes) vs the multi-kilobyte `room/info` response. Ideal for the `isRoomAlive()` method and the `getNextUrl` hot path during recording. Response format: `{ "data": [{ "alive": true/false, "room_id": "..." }] }`.

2. **`AbortController` in monitor instead of polling** — The old pattern checked `active` every 1 second in a tight loop. The new pattern uses a single `sleep(intervalMs, stopSignal.signal)` call. `stop()` calls `stopSignal.abort()`, making `sleep()` resolve immediately. This is consistent with the `AbortController` + `sleep()` pattern already used in `recorder/index.ts`.

3. **`check_alive` parameters** — Uses the same parameters as tokdl: `aid=1988&region=CH&room_ids={id}&user_is_login=true`. The `room_ids` parameter (plural) is intentional — the endpoint accepts multiple comma-separated IDs but we send one.

4. **Cache-first in `isRoomAlive()`** — If the roomId matches the cached `LiveInfo`, the cached `isLive` value is returned without any network call. Only cache misses trigger `check_alive`.

## Current State

### Working
- 4 new tests + 2 fixtures for `check_alive` endpoint
- All 66 tests pass (was 62)
- Clean `tsc --noEmit`
- `monitor.ts` — immediate stop via AbortController (no more 1s polling lag)
- `isRoomAlive()` — lightweight boolean check via `/webcast/room/check_alive/`
- `getNextUrl()` — uses `isRoomAlive()` before fetching stream URL

### Detection flow (end-to-end)
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

getNextUrl() during recording
  ├─ isRoomAlive(roomId) [check_alive] → if dead, stop
  ├─ Invalidate cache
  └─ getLiveUrl(roomId) [room/info] → stream URL
```

## Next Steps / Pending

- [ ] **Chrome/Chromium cookie extraction** — `browser-cookies.ts` currently only supports Firefox. Add Chromium-based browser cookie extraction (Chrome, Edge, Brave, etc.) from their SQLite cookie stores.

## Important Context

- **`room/check_alive/` endpoint**: `https://webcast.tiktok.com/webcast/room/check_alive/?aid=1988&region=CH&room_ids={roomId}&user_is_login=true`. Not behind WAF. Response is `{ "data": [{ "alive": boolean, "room_id": string }] }`. Discovered from tokdl: `/home/envs4/workspaces/tokdl/packages/lib/src/client.ts`.

- **`room/info` vs `check_alive`**: Use `room/info` when you need stream URLs or full room metadata. Use `check_alive` when you only need a live/offline boolean — it's ~100 bytes vs multiple KB.

- **`getNextUrl` flow**: During recording, `getNextUrl` is called by the downloader to refresh the stream URL (for segmenting or reconnection). Using `check_alive` first avoids unnecessary full page rescans when the stream is still healthy.

- **Monitor pattern**: The `createPollingMonitor` now uses `new AbortController()` internally. The `stop()` method aborts the signal and awaits the current tick. This is the same pattern used in `recorder/index.ts` for the `pendingRemuxes` timeout.

- **RoomIds are per-session**: The roomId changes each time the user goes live. In the fixture: `7649515096078600981` (old). Do NOT hardcode roomIds.

- **TikTok WAF**: The Slardar WAF on `www.tiktok.com` blocks HTML page requests from non-browser clients. The `/api-live/user/room/` and `/webcast/room/*` API endpoints are not behind the WAF.

- **Published**: `@zfadhli/tokrec` v0.7.1 on npm.
