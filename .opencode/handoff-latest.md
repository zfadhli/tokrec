# Session Handoff — 2026-06-14 12:52

## Goal

Resume from the previous session's pending items and fix the live detection (app reported user as offline when actually live due to TikTok's Slardar WAF blocking `www.tiktok.com` HTML pages).

## Files Modified/Created

| File | Summary of changes |
|---|---|
| `src/api/rate-limiter.ts` | **New** — Token-bucket rate limiter with AbortSignal-aware wait. Created in this session. |
| `src/api/tiktok.ts` | Added `logger?` + `showDebug?` params to `createTikTokApi`. Added `fetchLiveInfoFromApi()` fallback using `/api-live/user/room/` endpoint. Added `tryFetchPage()` helper that tries `www.tiktok.com` + `m.tiktok.com` and rejects Slardar WAF pages. Added debug logging throughout `fetchLiveInfo()`. |
| `src/api/client.ts` | Changed TLS fingerprint `chrome_142` → `firefox_149`. Added browser-like headers (`User-Agent`, `Accept`, etc.). Now seeds **all** Firefox cookies (not just `sessionid_ss`/`tt-target-idc`). Extracted `rateLimitedFetch()` helper integrating rate limiter. |
| `src/browser-cookies.ts` | Rewrote `extractTikTokCookiesFromFirefox()` to return ALL cookies for `.tiktok.com` / `.tiktokv.com` domains instead of filtering to just `sessionid_ss` + `tt-target-idc`. Type changed from `TikTokCookies` → `Record<string, string>`. |
| `src/config.ts` | Changed `CookieAuth` from interface → `Record<string, string>`. Added `ratePerSecond` field (default 5). Added `debug` field (default false). Changed `segmentMinutes` default from 20 → 0. |
| `src/cli.ts` | Added `--rate <n>`, `--debug`, and updated `--segment-minutes` help/default. |
| `src/index.ts` | Cookie loading tracks source (Firefox vs cookies.json). Shows cookie count in startup output. Updated `loadCookies()` return type. |
| `src/recorder/index.ts` | Orphaned sleep timer in `stop()` fixed via `AbortController` + `.finally()`. Passes `logger` and `cfg.debug` through to `createTikTokApi()`. |
| `src/recorder/post-processing.ts` | Extracted `convertFile()` helper from `processConversion`/`runFallbackConversion`. Fixed stale `FLV` → `TS` in comments, renamed `flvMtimeMs` → `fileMtimeMs`. |
| `src/recorder/ffmpeg-utils.ts` | Added `pipeFfmpegSegment()` shared function (extracted from `download-stream.ts`/`download-hls.ts`). |
| `src/recorder/download-stream.ts` | Simplified to use `pipeFfmpegSegment()`. Removed `currentProc` tracking. |
| `src/recorder/download-hls.ts` | Simplified to use `pipeFfmpegSegment()`. Removed `maxDurationTimer` from inner promise. |
| `src/recorder/convert.ts` | Fixed stale `FLV` → `TS` in comments. |
| `src/utils.ts` | `sleep(ms, signal?)` — added optional `AbortSignal` parameter that clears the timer and resolves early when the signal fires. |

## Key Decisions

1. **Firefox 149 TLS fingerprint over Chrome** — Chrome fingerprints (even `chrome_147`) get outright 403 from TikTok's Slardar WAF. Firefox gets challenge pages instead, and with the user's real Firefox cookies, works better with the API endpoints.

2. **`/api-live/user/room/` endpoint as primary WAF bypass** — Instead of trying to reverse-engineer the Slardar JS challenge, query TikTok's internal JSON API endpoint directly (`/api-live/user/room/?aid=1988&uniqueId={user}&sourceType=54`). This endpoint returns `roomId`, `status` (2=live, 4=offline), and user metadata — without going through the HTML page WAF.

3. **Extract ALL Firefox cookies** — The Slardar WAF challenge sets additional cookies (names unknown). Extracting all cookies from Firefox and seeding them into `wreq-js` was necessary to mimic a real browser session.

4. **Multi-domain page fetch** — `tryFetchPage()` tries `www.tiktok.com` first, then `m.tiktok.com`. Rejects pages under 5000 bytes or containing `"SlardarWAF"` (WAF challenge pages).

5. **Detection fallback chain** (in order): SIGI_STATE from HTML → userInfo fallback (Webcast API) → UserModule → API fallback (`/api-live/user/room/`) → Universal data → Profile page fetch.

6. **`--debug` flag gates `[API_DEBUG]` output** — Hidden by default; pass `--debug` to see diagnostic API call traces on stderr. All debug info always goes to `tiktok-recorder.log` at `debug` level.

7. **Segmenting disabled by default** — `segmentMinutes` default changed from 20 → 0 (single MP4 output). Pass `-s 20` to re-enable.

## Current State

### Working
- Firefox cookie extraction (30+ cookies, all domains)
- API rate limiting (token bucket, 5 req/s default, `--rate` flag)
- AbortSignal-aware `sleep()` with orphaned timer fix in `stop()`
- Multi-domain page fetch with WAF rejection
- **API fallback** (`/api-live/user/room/`) for live detection when WAF blocks HTML pages — verified working with live endpoint
- Segment extraction (`convertFile()` helper)
- All 62 existing tests pass
- Clean `tsc --noEmit`

### Live detection flow (end-to-end)
```
fetchLiveInfo(user)
  ├─ tryFetchPage (www.tiktok.com → m.tiktok.com)
  │    └─ WAF blocks both (403 or challenge)
  │
  ├─ API fallback: /api-live/user/room/?aid=1988&uniqueId={user}&sourceType=54
  │    └─ Returns roomId + status (2=live, 4=offline) — NO WAF 🎯
  │
  └─ If live → Webcast API (/webcast/room/info/) for stream URL
```

### Known issue
- `m.tiktok.com` returns 404 for both `/live` and profile pages. This could change in the future. The `tryFetchPage` helper handles this gracefully (falls through to next domain or API).

## Next Steps / Pending

- [ ] Add Chrome/Chromium cookie extraction to `browser-cookies.ts` (currently Firefox-only).
- [ ] Consider adding `AbortError`-aware `sleep()` usage in other `Promise.race` patterns (e.g., the monitor polling loop in `monitor.ts`).
- [x] Add `--debug` flag to show `[API_DEBUG]` on terminal (completed this session).
- [ ] The `/webcast/room/info/` API works reliably — consider using `room/check_alive/` (as tokdl does) for faster/cheaper live checks instead of fetching the full room info.

## Important Context

- **TikTok WAF**: The Slardar WAF on `www.tiktok.com` blocks all HTML page requests from non-browser clients. The token-bucket rate limiter (5 req/s) was not the cause — even at 1 req/s the WAF blocks. The fix was to bypass page scraping entirely and use the `/api-live/user/room/` JSON API endpoint.

- **API endpoints discovered**:
  - `https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId={user}&sourceType=54` — Returns roomId, user status (2=live), user metadata. **Not behind WAF.**
  - `https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id={id}&type=live` — Returns room info + stream URL. **Not behind WAF.**

- **tokdl reference**: The `/api-live/user/room/` endpoint was discovered by examining `/home/envs4/workspaces/tokdl/packages/lib/src/client.ts`. That codebase uses `wreq-js` with `chrome_142` but calls this API endpoint directly, avoiding the HTML page WAF entirely.

- **Firefox browser profile**: Changed from `chrome_142` → `firefox_149`. Available profiles: `chrome_142`–`chrome_147`, `firefox_149`, `safari_18.3`, `edge_147`.

- **Published**: `@zfadhli/tokrec` v0.7.1 on npm.

- **RoomIds are per-session**: The roomId changes each time the user goes live. In the fixture: `7649515096078600981` (old), live response: `7651208051319524117` (current). Do NOT hardcode roomIds.

- **Cookie type change**: `CookieAuth` is now `Record<string, string>` (was an interface with `sessionid_ss` + `tt-target-idc`). Any code accessing `config.cookies.sessionid_ss` should use `in` operator check or bracket notation.
