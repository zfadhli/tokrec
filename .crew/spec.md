# Spec — honest LIVE status reporting (age-protected / restricted rooms)

Supersedes the workspace-split spec, which shipped in commit `166f7af`. Evidence for every claim: `.crew/research/age-protected-live-evidence.md`. Vocabulary: `.crew/GLOSSARY.md`.

## Problem

When TikTok refuses stream data for a live room, tokrec reports a false verdict. `4003110` from `/webcast/room/info/` is collapsed into `null` (`packages/tokrec/src/core/api/tiktok.ts:316`); the recorder then logs `live but no stream URL found` and emits `tick {isLive: false}` (`packages/tokrec/src/core/recorder/index.ts:123-128`). For an **age-protected** LIVE — `check_alive=true`, `streamData` absent, `4003110` on every room/info variant — the user sees either a bogus offline state or a message that sends them hunting for better cookies. Separately, `/api-live/user/room/`, the only username→roomId API, is gated behind `!html || html.length < 5000` (`tiktok.ts:187`), so a long age-wall page skips it entirely.

No client-side fix can fetch a gated stream: Michele0303 v7.7.1 and tiktok-live-connector 2.5.0 receive the identical refusal with the same cookies. The fix is to report the truth, and to stop skipping the endpoint that still answers.

## Acceptance criteria

1. Room live + stream data refused (`4003110`, or `check_alive=true` with no `streamData` from any path) → user-visible line distinctly says the LIVE is **age-protected/restricted** (new `[LOCK]`-style line), never `[OFF]`; the tick carries `isLive: true` and `reason: "restricted"`; the log includes the raw `status_code`.
2. Room live and stream URL resolved → unchanged behavior and output.
3. Offline room (e.g. `/api-live/user/room/` returns `status=4` with a roomId) → `[OFF]`; no "live but no stream URL" false positive. Tick `isLive: false, reason: "offline"`.
4. Live + alive + no URL and no `4003110` → distinguishable in logs/tick via `reason: "no-stream-url"`; UI shows a non-offline line.
5. No discovery path produced a roomId → tick `reason: "no-room-id"`; network/parse failure across paths → `reason: "error"`. Both render as offline in the UI but are distinct in logs/`--debug` output.
6. `/api-live/user/room/` is attempted whenever page paths yielded no roomId, regardless of page size; a >5000-byte page without SIGI_STATE still reaches it.
7. `--debug` output names the reason and the discovery source per tick.
8. Fixture `room-info-restricted.json` captures the verbatim `4003110` body; unit tests cover criteria 1, 3, 6 with `createMockHttp`.
9. `bun run lint && bun run typecheck && bun test && bun run build` all exit 0; existing tests pass with additions only, no assertion edits.
10. README explains that app playback does not transfer to the web session and age-protected LIVES need an age-cleared web session; CHANGELOG Unreleased notes the new reporting.

## Interface deltas

- `packages/tokrec/src/lib/config.ts`: new exported `type LiveReason = "live" | "offline" | "restricted" | "no-stream-url" | "no-room-id" | "error"`. `RecorderEventHandler["tick"]` payload becomes `{ user: string; isLive: boolean; roomId?: string; reason?: LiveReason }` (additive).
- `packages/tokrec/src/core/api/tiktok.ts`: `LiveInfo` gains `reason: LiveReason` and `source: string` and is **exported**; `TikTokApi` gains `getLiveInfo(user: string): Promise<LiveInfo>` (additive). `getRoomId`, `isRoomAlive`, `getLiveUrl`, `invalidateCache` signatures unchanged.
- `packages/tokrec/src/index.ts`: export type `LiveReason` (additive).
- `packages/cli/src/ui.ts`: `Display` gains `userRestricted(user: string): void` and `userLiveNoStream(user: string, roomId: string): void` (additive).
- `packages/cli/src/bin.ts`: tick handler branches on `reason` before `isLive`.
- `scripts/capture-fixtures.ts`: accepts repeatable `--user <name>` and `--help`; writes `<user>-api-live.json` in addition to the existing files; default users unchanged.

## Out of scope

- Any bypass of TikTok's age/entitlement gate: no signed requests (X-Bogus, Euler Stream), no mobile/app APIs, no port of Michele's raw-HTML page regex (proven dead on the same page), no external signing services.
- Stream-candidate list + probing (FLV/HLS fallbacks): no evidence of a `live-no-stream` room where a URL exists but the first pick fails.
- Cookie-jar seeding changes (`client.ts:48` `sessionid_ss` gate, domain list).
- `tokrec --version` exit-1 quirk (known, unrelated).
