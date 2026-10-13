# Evidence — age-protected LIVE handling

Captured 2026-10-14, from `/home/envs4/workspaces/tokrec`, using the Firefox cookie jar tokrec reads (29 cookies, `tt-target-idc=alisg`). Repro account: `itsbaitong4` (live, room `7696184043282287367`). Second account tested: `00chaeyupi`.

## tokrec's own trace (`createTikTokApi(..., showDebug=true)`)

```
tryFetchPage: https://www.tiktok.com/@itsbaitong4/live succeeded (239504 bytes)
fetchLiveInfo: SIGI_STATE found
fetchLiveInfo: liveRoom=true, userInfo=true, userInfo.roomId=7696184043282287367
fetchLiveInfo: primary path — roomId=7696184043282287367, status=2, isLive=true
fetchFromRoomApi: roomId=7696184043282287367 status=200, ok=true
fetchFromRoomApi: roomId=7696184043282287367 returned 75 bytes
RESULT getRoomId: 7696184043282287367
RESULT getLiveUrl: null
```

SIGI for the same page: `LiveRoom.liveRoomUserInfo.liveRoom.status=2`, **`streamData` absent**, `needLogin=false`, `showLiveGate=false`, `isAgeGateRoom=false` (these three gate flags are also `false` in the healthy fixture — unreliable). Healthy fixture `anomaliaa27-live.html` differs only in `streamData present`.

## room/info variants — all `4003110`, 75 bytes

```
{"data":{"prompts":""},"extra":{"now":1791908411605},"status_code":4003110}
```

Tested and all refused: as shipped (`aid=1988&type=live`); `+Referer/Origin`; `+user_is_login=true`; full web param set (`app_language`, `browser_*`, `channel=tiktok_web`, `version_code=270400`, `webcast_sdk_version`); `msToken` query param; `www.tiktok.com` host; `aid=1233`; `aid=1233&app_name=tiktok_live`; `aid=1180`. `room/enter` → HTTP 403.

## Same session, other rooms (control)

```
itsbaitong4    api-live status=2  roomId=7696184043282287367 | room/info 4003110 stream_url=no  | check_alive=true
anomaliaa27    api-live status=4  roomId=7696112012440324885 | room/info 0      stream_url=yes | check_alive=false
naylaarindinta api-live status=4  roomId=7695074766070008597 | room/info 0      stream_url=yes | check_alive=false
00chaeyupi     api-live roomId=- status=-                    | —                              | —
```

So request shape, cookies, and client are fine — `4003110` is room-specific. `check_alive` exists independently and reports `true` for the restricted room.

## Third-party comparators

- **Michele0303/tiktok-live-recorder v7.7.1** (fresh clone, `uv sync`), cookies both per its GUIDE (`sessionid_ss` + `tt-target-idc`) and full Firefox jar: `ROOM_ID 7696184043282287367` → `API blocked by WAF (4003110)` → fallback `_get_stream_url_from_page` regex for `.flv`/`.m3u8` over raw HTML finds nothing → `UserLiveError: Live is private, login required`. `00chaeyupi` → "not hosting a live stream". Its "restricted LIVE fallback" (`src/core/tiktok_api.py:290-347`) is a page regex and is useless here.
- **zerodytrash/TikTok-Chat-Reader** uses `tiktok-live-connector@2.5.0`. Its `fetchRoomInfo()` returns the same `{data:{prompts:""}, status_code:4003110}` envelope. Chat still connects because the IM websocket is signed via Euler Stream; that channel carries no stream URL. Chat access ⇒ room exists, **not** stream access.
- Browser (same Firefox session) on `https://www.tiktok.com/@itsbaitong4/live` shows "This LIVE is age-protected"; the page's i18n contains `"pm_mt_live_share_log_in_u18_desc":"This LIVE is age-protected."` and no age-confirmation flow is offered. The TikTok app plays the same stream.

## Conclusion

`4003110` for this session is an account/session-level age gate on the video channel, not a tokrec bug. No web client can obtain stream data for it — tokrec, Michele, and the connector all get the same refusal. A web session that can play the LIVE receives `status_code=0` with `stream_url`; a web session that cannot must report the restriction honestly.
