# Fix TikTok API Layer — Use SIGI_STATE for Everything

## Problem
The tool reports users as offline when they're actually live because:
1. TikTok's Slardar WAF blocks unauthenticated requests to the webcast API
2. The webcast `check_alive` and `room/info` endpoints return errors even with cookies
3. `isRoomAlive()` and `getLiveUrl()` depend on these broken API calls

## Diagnosis (confirmed with live user `e.xuanch`)
- `cookies.json` with valid `sessionid_ss` **bypasses the WAF** for HTML page fetches
- SIGI_STATE at `https://www.tiktok.com/@user/live` contains **all needed data**:
  - Room ID: `LiveRoom.liveRoomUserInfo.user.roomId`
  - Live status: `LiveRoom.liveRoomUserInfo.liveRoom.status` (2=live, 4=offline)
  - FLV stream URL: `LiveRoom.liveRoomUserInfo.liveRoom.streamData.pull_data.stream_data` (JSON string → `data.hd.main.flv`)

## Files to Change

### 1. `src/api/tiktok.ts` — Complete rewrite

Replace the current architecture (3 separate API calls + per-tick cache) with a single `fetchLiveInfo()` that gets everything from one HTML fetch.

**Key changes:**
- Add `invalidateCache()` to the public `TikTokApi` interface
- `fetchLiveInfo(user)` → fetches page once → returns `{ roomId, isLive, streamUrl, title }`
- Per-tick cache: all 3 methods share the same cached result
- Remove dead code: `fetchPage`, `fetchRoomIdFromApi`, `extractSdkStreamUrl`, `extractFlvPullUrl`, `unescapeUnicode`
- Remove unused constants: `API_LIVE`, `WEBCAST_BASE`

### 2. `src/recorder/stream.ts` — Remove broken health check

Replace the `api.isRoomAlive(roomId)` call during recording (which fails) with a simple download progress log.

### 3. `src/recorder/index.ts` — Add `invalidateCache()` call

Call `api!.invalidateCache()` at the start of each tick to ensure fresh data.

## Verification
```bash
bunx tsc --noEmit          # type check
bunx biome ci src/         # lint
bun test                   # all 26 tests pass
bun run src/index.ts --user e.xuanch  # smoke test (needs cookies.json)
bunx tsdown               # build
```
