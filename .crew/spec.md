# Spec — resolver chain extraction in `core/api`

Supersedes the age-protected-LIVE ledger (archived in git at `cf398d7`). Design approved in session 2026-10-15; scope refined during planning: `room-info` is a shared helper, not a chain source — the chain is the three actual sequential phases (page/SIGI → api-live → profile).

## Problem

`packages/tokrec/src/core/api/tiktok.ts` is 815 LOC and holds four kinds of code at once: pure parsing, Webcast endpoint primitives, the Webcast room-info→LiveInfo mapping, and three resolution strategies interleaved in one 148-line `fetchLiveInfo`. Adding the api-live fallback in `cf398d7` edited the same refusal block at four sites. There is no way to test a strategy without standing up the whole orchestrator.

Reference reconnaissance: `Yoganataa/tiktok-live-recorder-ts` (`/tmp/tlr-ts`, @yoganataa/tstok 2.1.0) solves this with a `RoomResolver` interface + `RoomResolverChain`, but has zero tests, no DI, and sends the session cookie to third-party resolvers. We borrow the seam, not the code.

## Goal

Split `tiktok.ts` into pure parsing / shared page+webcast primitives / one file per resolution phase behind a single internal `RoomSource` interface and ordered chain. Zero behavior change. No public API change.

## Acceptance criteria

1. `packages/tokrec/src/core/api/parse.ts` exports, with identical signatures: `SigiState`, `extractSigiState`, `extractUserFromUniversalData`, `extractStreamUrlFast`, `findStreamUrlRecursively`.
2. `packages/tokrec/src/core/api/webcast.ts` exports a factory that owns: `RoomApiResult<T>`, `fetchFromRoomApi`, `fetchCheckAlive`, `fetchStreamUrlFromApi`, `resolveRefusedRoom`, `fetchRoomInfoFromRoomApi`. Transport-error flagging is injected via a `flagError` callback, not module-global state.
3. `packages/tokrec/src/core/api/page-fetch.ts` owns `tryFetchPage` + `TIKTOK_BASES` (the WAF heuristic), injectable `http`/`debug`.
4. `packages/tokrec/src/core/api/resolvers/types.ts` defines internal `RoomSource { name: string; resolve(ctx): Promise<LiveInfo | null> }` and `ResolveContext`. `LiveInfo` moves here (or stays re-exported) but is still importable from `./tiktok` by `recorder/index.ts` and tests without edits to those call sites.
5. Resolvers exist one per phase: `resolvers/page.ts` (SIGI primary + userInfo/legacy fallback + universal-data → room-info), `resolvers/api-live.ts`, `resolvers/profile.ts`. Each file < 150 LOC.
6. `fetchLiveInfo` in `tiktok.ts` is a chain loop over `[page, api-live, profile]`: first non-null `LiveInfo` wins; a resolver that throws aborts the chain and sets `lastFetchHadError` (matches today's page-phase outer catch); a resolver that internally catches calls `flagError()` and returns `null`, letting the chain continue (matches today's api-live → profile behavior). `lastFetchHadError` still resets at the start of each tick.
7. Every `LiveInfo.source` string is unchanged: `"sigi"`, `"api-live"`, `"room-info"`, `"profile"`, `"none"`. Every `LiveReason` outcome is unchanged for every path, including `4003110` + `check_alive` true/false.
8. `tiktok.ts` drops below 350 LOC and contains only: the `TikTokApi` interface, `createTikTokApi` orchestration (cache, chain wiring, public methods), and type re-exports. No resolution logic.
9. No change to `packages/tokrec/src/index.ts` exports; `createTikTokApi` stays non-public. No signature change to `getRoomId`/`isRoomAlive`/`getLiveUrl`/`getLiveInfo`/`invalidateCache`.
10. Existing test assertions are byte-unchanged; only import paths for moved symbols may be edited. `packages/*/test/fixtures/**` untouched.
11. Gate: `bun run lint` 0 errors, `bun run typecheck` 0, `bun test` all green (85 existing + new), `bun run build` exit 0.

## Out of scope

Public resolver injection/extension point; proxy, parallel recordings, Telegram uploader, followers tracker; error-class hierarchy; candidate-URL (FLV/HLS) probing; any cookie-handling change; behavior changes of any kind.
