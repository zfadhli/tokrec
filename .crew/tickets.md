# Tickets — resolver chain extraction in `core/api`

Spec: `.crew/spec.md`. All work in `/home/envs4/workspaces/tokrec`, base commit `cf398d7`. Supersedes the age-protected-LIVE ledger (archived in git at `cf398d7`; its duplicate open t10 was reconciled 2026-10-15 — no mp4s tracked, `.gitignore:37`).

Working rules for every ticket: read each file before editing it; `bun:test`; never touch `packages/*/test/fixtures/**` (Biome-excluded raw bytes); **no state-changing git commands** (`checkout`/`reset`/`clean`/`add`/`commit`/`stash`); report evidence — command, exit status, verbatim output. Line anchors below are as of `cf398d7`; locate symbols by name once earlier tickets shift them.

## Ledger

- [x] t1 extract pure parsing to `parse.ts` (smith) — done — evidence: `bun test packages/tokrec` 59 pass/0 fail (108 expects), `bun run typecheck` exit 0, `bun run lint` exit 0 (5 pre-existing warnings); `parse.ts` 171 LOC with the 5 symbols, `tiktok.ts` 815→650, verbatim check OK, fixtures diff empty — [parallel-safe: no, needs: none]
- [x] t2 extract Webcast primitives to `webcast.ts` (smith) — done — evidence: `bun test packages/tokrec` 59 pass/0 fail, typecheck exit 0, lint exit 0; `webcast.ts` 178 LOC with factory+5 fns, `tiktok.ts` 650→503, single `flagError()` call, 10 call sites retargeted, fixtures untouched — [parallel-safe: no, needs: t1]
- [x] t3 extract page fetcher to `page-fetch.ts` (smith) — done — evidence: `bun test packages/tokrec` 59 pass/0 fail, typecheck exit 0, lint exit 0; `page-fetch.ts` 41 LOC, `tiktok.ts` 503→472, both call sites delegate, fixtures untouched — [parallel-safe: no, needs: t2]
- [x] t4 `resolvers/types.ts` + `resolvers/page.ts` (smith) — done — evidence: `bun test packages/tokrec` 59 pass/0 fail, typecheck exit 0, lint exit 0; `types.ts` 26 LOC, `page.ts` 210 LOC (over criterion-5 budget → spun out as t4b), `tiktok.ts` 472→285, `LiveInfo` re-exported from `tiktok.ts`, throws propagate — [parallel-safe: no, needs: t3]
- [x] t4b split page resolver under 150 LOC (smith) — done — evidence: `page.ts` 210→137 (<150), `sigi-legacy.ts` 76 LOC with `fetchSigiLegacy(sigi, ctx)`, tests 59 pass/0 fail, typecheck+lint exit 0 — [parallel-safe: no, needs: t4]
- [x] t5 `resolvers/api-live.ts` (smith) — done — evidence: `api-live.ts` 84 LOC moved verbatim, internal catch → `flagError()+null`, `tiktok.ts` 285→203, tests 59 pass/0 fail, typecheck+lint exit 0 — [parallel-safe: no, needs: t4b]
- [x] t6 `resolvers/profile.ts` (smith) — done — evidence: `profile.ts` 34 LOC, `tiktok.ts` 203→170, tail is resolver calls only, tests 59 pass/0 fail, typecheck+lint exit 0 — [parallel-safe: no, needs: t5]
- [x] t7 chain wiring + `tiktok.ts` < 350 LOC (smith) — done — evidence: `tiktok.ts` 170→160 LOC, chain loop verified by read (reset → try resolve → non-null wins → catch flags+aborts), tests 59 pass/0 fail, typecheck+lint exit 0 — [parallel-safe: no, needs: t6]
- [x] t8 per-source unit tests (smith) — done — evidence: `resolvers.test.ts` +7 tests/29 expects, all 6 required cases; `bun test packages/tokrec` 66 pass/0 fail; deviation: 404 does not flag (matches base — `!res.ok` short-circuits), true transport failure simulated via throwing `get`, counter==1 — [parallel-safe: yes, needs: t7]
- [x] t9 full green gate (smith→orchestrator) — done — evidence (orchestrator inline): `bun run lint` exit 0 (0 errors, 5 pre-existing warnings), `bun run typecheck` exit 0 both pkgs, `bun test` 92 pass/0 fail/166 expects/10 files, `bun run build` exit 0 lib+cli; LOC: tiktok.ts 160, page 137, api-live 84, sigi-legacy 76, webcast 178, parse 171, page-fetch 41, profile 34, types 26 — [parallel-safe: no, needs: t1..t8]
- [x] t10 spec-axis review (sage) — done — verdict: criteria 1–11 satisfied, behavior-preserving, no critical/major. Parity map: 5 old flag sites + reset all accounted for (old:164→tiktok.ts:135, old:269→chain catch :150-156, old:331→profile.ts:29, old:415→api-live.ts:79, old:450→webcast.ts:59); sources/refuse-sites/URLs/params byte-identical; `index.ts` diff empty; fixtures diff empty. Minors: (a) `ResolveContext.http` in brief+body but not spec sketch — matches old behavior, accepted; (b) page resolve no-catch routing verified same terminal behavior; (c) cosmetic comment drift → t12 — [parallel-safe: yes, needs: t9]
- [x] t11 standards-axis review (scout) — done — verdict: no critical/major; tests exercise real logic; fixtures byte-untouched; no runtime cycle from type-only `LiveInfo` import; scope clean. Minors: (a) emitted `source` asserted only for api-live/sigi → t12; (b) stale header comment `tiktok.ts:4-8` → t12 — [parallel-safe: yes, needs: t9]
- [x] t12 close review minors: comment drift + emitted-source assertions (smith) — done — evidence: `bun test packages/tokrec` 68 pass/0 fail (was 66) with 2 new delegated-`room-info` source-pinning tests; typecheck+lint exit 0; `tiktok.ts` header rewritten, 159 LOC; fixtures untouched — [parallel-safe: yes, needs: t10,t11]

## Briefs

### t1 — extract pure parsing to `parse.ts`

Create `packages/tokrec/src/core/api/parse.ts`. Move verbatim, signatures unchanged and exported: `SigiState` (tiktok.ts:645-679), `extractSigiState` (681-702), `extractUserFromUniversalData` (704-731), `extractStreamUrlFast` (733-764), `findStreamUrlRecursively` (766-810). No behavior edits, no reformatting beyond what `bun run lint` demands.

`tiktok.ts` imports them from `./parse` and keeps no local copies. Update test imports only: `packages/tokrec/test/tiktok-api.test.ts:12-15` (keep `createTikTokApi` from `../src/core/api/tiktok`; move `extractSigiState`, `extractUserFromUniversalData`, `findStreamUrlRecursively` to `../src/core/api/parse`) and `packages/tokrec/test/tiktok.test.ts:2` (`findStreamUrlRecursively` from `../src/core/api/parse`). Test assertions byte-unchanged.

Interface delta: `parse.ts` becomes the home of the four pure helpers; `tiktok.ts` no longer exports them.

### t2 — extract Webcast primitives to `webcast.ts`

Create `packages/tokrec/src/core/api/webcast.ts` exporting:

```ts
export type RoomApiResult<T> = { ok: true; value: T | null } | { ok: false; statusCode: number; body: string }
export function createWebcastApi(http: HttpClient, debug: (msg: string) => void, flagError: () => void): {
  fetchFromRoomApi: ...; fetchCheckAlive: ...; fetchStreamUrlFromApi: ...; fetchRoomInfoFromRoomApi: ...; resolveRefusedRoom: ...
}
```

Move verbatim: `RoomApiResult` (tiktok.ts:41-45), `fetchFromRoomApi` (427-463), `fetchCheckAlive` (465-491), `resolveRefusedRoom` (493-509), `fetchRoomInfoFromRoomApi` (511-557), `fetchStreamUrlFromApi` (629-634). Replace every `lastFetchHadError = true` inside moved code with `flagError()`. `WEBCAST_BASE` moves here. `fetchRoomInfoFromRoomApi` imports `findStreamUrlRecursively` from `./parse`; `fetchStreamUrlFromApi` too.

In `createTikTokApi`, construct once: `const webcast = createWebcastApi(http, debug, () => { lastFetchHadError = true })`, and change internal call sites (`fetchLiveInfo` primary/fallback paths, `fetchLiveInfoFromApi`, `fetchLiveInfoFromProfile`) to `webcast.*`.

Interface delta: internal factory added; `lastFetchHadError` now reachable from the module only via callback.

### t3 — extract page fetcher to `page-fetch.ts`

Create `packages/tokrec/src/core/api/page-fetch.ts`. Move `TIKTOK_BASES` (tiktok.ts:37) and `tryFetchPage` (136-159) into `createPageFetcher(http: HttpClient, debug: (msg: string) => void)` returning the `tryFetchPage` function with the same signature `(user, path) => Promise<{ html, baseUrl } | null>`. WAF heuristic (`html.length < 5000 || html.includes("SlardarWAF")`) unchanged. `tiktok.ts` constructs it in `createTikTokApi` and delegates.

Interface delta: internal factory; `TIKTOK_BASES` out of `tiktok.ts`.

### t4 — `resolvers/types.ts` + `resolvers/page.ts`

Create `packages/tokrec/src/core/api/resolvers/types.ts`:

```ts
import type { HttpClient } from "../client"
export interface LiveInfo { roomId: string | null; isLive: boolean; streamUrl: string | null; title: string | null; reason: LiveReason; source: string }
export interface ResolveContext {
  user: string
  debug: (msg: string) => void
  fetchPage: (user: string, path: string) => Promise<{ html: string; baseUrl: string } | null>
  webcast: ReturnType<typeof createWebcastApi>
  flagError: () => void
}
export interface RoomSource { readonly name: string; resolve(ctx: ResolveContext): Promise<LiveInfo | null> }
```

Move the `LiveInfo` declaration (tiktok.ts:636-643) into `types.ts`. `tiktok.ts` re-exports it (`export type { LiveInfo } from "./resolvers/types"`) so `recorder/index.ts` and both test files keep importing from `./tiktok`/`../src/core/api/tiktok` unchanged.

Create `packages/tokrec/src/core/api/resolvers/page.ts` exporting `createPageSource(): RoomSource` (zero-arg; all collaborators arrive via `ctx`) with `name: "page"`. Move the page/SIGI phase of `fetchLiveInfo` (tiktok.ts:161-307, i.e. everything up to and including the universal-data block) plus `fetchLiveInfoFallback` (558-627) verbatim, with `http`→`ctx.fetchPage` only where the page fetch happens (`tryFetchPage(user, "/live")`); `ctx.flagError()` replaces `lastFetchHadError = true`. Do **not** add a top-level try/catch — throws must propagate (the orchestrator's existing outer catch reproduces today's abort).

In `tiktok.ts`, `fetchLiveInfo` temporarily becomes: reset flag → `try { const info = await pageSource.resolve(ctx); if (info) return info } catch { flagError; return null }` → then the existing inline api-live + profile tail unchanged.

Interface delta: `LiveInfo` file move + re-export; `RoomSource`/`ResolveContext` added.

### t4b — split page resolver under 150 LOC

Spec criterion 5 caps each resolver at 150 LOC; `resolvers/page.ts` is 210. Create `packages/tokrec/src/core/api/resolvers/sigi-legacy.ts` exporting `fetchSigiLegacy(sigi: SigiState, ctx: ResolveContext): Promise<LiveInfo | null>`; move the local `fetchLiveInfoFallback` from `page.ts` verbatim into it (signature adapted to `ctx`, calls `ctx.webcast.fetchStreamUrlFromApi`/`resolveRefusedRoom`, `findStreamUrlRecursively` from `../parse`). `page.ts` imports and calls it. No behavior change.

### t5 — `resolvers/api-live.ts`

Create `packages/tokrec/src/core/api/resolvers/api-live.ts` exporting `createApiLiveSource(): RoomSource`, `name: "api-live"`. Move `fetchLiveInfoFromApi` (tiktok.ts:344-425) verbatim; it takes `user` from `ctx`, calls `ctx.webcast.fetchStreamUrlFromApi` / `ctx.webcast.resolveRefusedRoom`, keeps its internal try/catch → `ctx.flagError(); return null`. `source: "api-live"` strings unchanged.

`tiktok.ts` deletes the local function and calls the source from `fetchLiveInfo`.

### t6 — `resolvers/profile.ts`

Create `packages/tokrec/src/core/api/resolvers/profile.ts` exporting `createProfileSource(): RoomSource`, `name: "profile"`. Move `fetchLiveInfoFromProfile` (tiktok.ts:309-342) verbatim; `ctx.fetchPage(user, "")`, `ctx.webcast.fetchRoomInfoFromRoomApi`, internal catch → `ctx.flagError(); return null`.

`tiktok.ts` deletes the local function and calls the source from `fetchLiveInfo`.

### t7 — chain wiring

In `createTikTokApi` construct the sources once: `pageSource`, `apiLiveSource`, `profileSource`, and `const sources: RoomSource[] = [pageSource, apiLiveSource, profileSource]`. `fetchLiveInfo` becomes:

```ts
async function fetchLiveInfo(user: string): Promise<LiveInfo | null> {
  lastFetchHadError = false
  const ctx: ResolveContext = { user, debug, fetchPage, webcast, flagError: () => { lastFetchHadError = true } }
  for (const source of sources) {
    try {
      const info = await source.resolve(ctx)
      if (info) return info
    } catch (_err) {
      debug(`fetchLiveInfo: ${source.name} threw — ...`)
      lastFetchHadError = true
      return null
    }
  }
  return null
}
```

Delete the now-empty inline phase code. `tiktok.ts` must end below 350 LOC and contain only: imports, `TikTokApi` interface, `LiveInfo` re-export, `createTikTokApi` (cache + wiring + five public methods), resets. Behavior to preserve exactly: throw in page phase aborts chain; api-live/profile internal catch continues to next source; non-null short-circuits; flag resets per tick.

### t8 — per-source unit tests

New `packages/tokrec/test/resolvers.test.ts` using `createMockHttp`/`loadFixture` from `test/utils/mock-http.ts` (read it first). Construct each source directly with a minimal `ResolveContext` (stub `flagError` counter). Minimum cases: (a) `createPageSource` with restricted fixture path → `source: "sigi"` or delegated `"room-info"`, `reason: "restricted"`/`"offline"` per existing fixture semantics; (b) `createApiLiveSource` with api-live JSON `status: 4` → `reason: "offline"`, `source: "api-live"`, `isLive: false`; (c) `createProfileSource` with a page whose universal data has `userId` but no `roomId` → returns `null`, no throw; (d) each source's `name` is unique and matches its emitted `source` strings. Assertions may reuse existing fixtures; do not add fixtures.

### t9 — full green gate

From repo root, report exit status + counts for: `bun run lint` (0 errors), `bun run typecheck`, `bun test` (all pass; report total), `bun run build` (lib then cli). Fix only regressions introduced by t1–t8. Also report `wc -l packages/tokrec/src/core/api/tiktok.ts` and per-resolver LOC.

### t10/t11 — review gate

- t10 (sage, spec axis): does the result satisfy `.crew/spec.md` acceptance criteria 1–11? Enumerate every path that sets `lastFetchHadError`, every `source` string, and the `4003110` handling in all three phases against `cf398d7`. Unsupported claim or missed criterion → report with file:line.
- t11 (scout, standards axis): repo conventions (`AGENTS.md`), tests exercise real logic, fixtures untouched (`git diff` on fixtures empty), no leaked debug debris, no public-export change (`packages/tokrec/src/index.ts` identical), no scope creep.

Both report findings with file:line and a severity each; orchestrator appends criticals as new tickets.

### t12 — close review minors: comment drift + emitted-source assertions

1. `packages/tokrec/src/core/api/tiktok.ts`: rewrite the stale file header (lines 4–8, currently describes SIGI `/live` + profile fallback as if inline) to describe the real shape — `createTikTokApi` orchestrates a thin cache plus an ordered source chain (page → api-live → profile) declared in `resolvers/`; parsing lives in `parse.ts`, Webcast endpoints in `webcast.ts`. Remove/replace the stale inline section comment before `fetchLiveInfo` that says "Internal: fetch and parse SIGI_STATE / Universal Data" (parsing no longer lives here). Comments only — zero code changes.

2. `packages/tokrec/test/resolvers.test.ts`: add emitted-`source` assertions for the delegated paths so every source string is pinned by a direct test. Read the existing file and fixtures first, reuse their harness. Minimum: a `createProfileSource()` case where the profile page carries a roomId → resolves through `ctx.webcast.fetchRoomInfoFromRoomApi` and emits `source: "room-info"` (use the healthy `anomaliaa27-*` fixture pairing or the equivalent already used in `tiktok-api.test.ts`); if the page resolver's universal-data path is not already asserted to emit `"room-info"`, add that too. No fixture edits (read-only).

Evidence required (command + exit status + verbatim relevant output): `bun test packages/tokrec`, `bun run typecheck`, `bun run lint`. Report under 250 words.

## Architecture proposal — PR A–D (GitHub issues)

Design: `docs/architecture-proposal.html` (untracked until committed). Base commit `c322f20`. Strictly sequential; the only breaking change lands in D.

- [x] #29 A — move `core/` into `domain/ policy/ ports/ adapters/ session/`, relocate shared types, add `packages/tokrec/test/architecture.test.ts` guardrail. Zero runtime logic change; test assertions byte-unchanged — done in `99b1a73`, evidence: `bun run lint` 0 errors/5 warnings, `bun run typecheck` 0, `bun test` 99 pass/0 fail (95 + 4 guardrail), `bun run build` 0; fixtures diff empty; guardrail proven red by `node:fs` in `domain/verdict.ts` — deviations: same-zone edges allowed for every band, `root` allows `lib`, type-only edges exempt (documented in the test file) — [parallel-safe: yes for #30, needs: none]
- [x] #30 B — `Verdict` + `verdictOf`, `Candidate` chain (fixes the `core/api/tiktok.ts:154` dead-end), delete 22 hand-built `LiveInfo` literals, `toLiveInfo` shim — done — evidence: `bun run lint` 0 errors/5 pre-existing warnings, `bun run typecheck` 0, `bun test` 114 pass/0 fail/206 expects/12 files (99 → 114: +10 `verdict.test.ts` table/shim, +1 chain-resilience, +1 page-fallback resilience, +3 `discover` unit), `bun run build` 0; architecture guardrail 4/4 pass; sage review found 2 majors fixed + re-gated: page-internal `failed` no longer skips sigi-legacy/universal-data (failure held aside, returned only if nothing hits), `discover` catches sync throws too, first failure kept as root cause; dead-end regression `packages/tokrec/test/tiktok-api.test.ts` "page source throw falls through to api-live" asserts `evidence=[{page,error},{api-live,hit}]`; no `RoomSource`/`flagError`/`resolveRefusedRoom`/`fetchRoomInfoFromRoomApi` left; src 2706→2725 net (verdict 30→108, new `candidates.ts` 58 + `chain.ts` 52, ports 26→35, types 17→26; probe 160→122, page 138→109, api-live 85→46, sigi-legacy 77→32, webcast 162→130) — deviations: net +19 not −80 because Verdict/Candidate infra (+219) offsets literal removal (−200); `verdictOf` is the only reason constructor (legacy `isLive`/`source` only in the `toLiveInfo` projection); a `failed` candidate outranks a later `miss` but room/denied end the chain; `api.getVerdict` added as the new surface, `getLiveInfo` now `toLiveInfo(await getVerdict)`; error/no-room verdicts are now cached for the tick (old `ensureCache` re-fetched after a null result); known `getLiveUrl` `ensureCache(cachedUser || roomId)` misuse left untouched (out of B scope) — [parallel-safe: no, needs: #29]
- [x] #31 C — pure `planTick`, delete `decideTick` and the `onTick` if-chain, 24-row table test — done — evidence: `bun run lint` 0 errors/5 pre-existing warnings, `bun run typecheck` 0, `bun test` 135 pass/0 fail/232 expects/13 files, `bun run build` 0; architecture guardrail 4/4 pass; `packages/tokrec/src/policy/tick.ts` (50 LOC) exposes `TickFacts`/`TickPlan`/`planTick` with `stopRequested → user`, `live → record|poll`, `restricted|no-stream-url → hold`, `offline → one-shot stop|poll`, `no-room-id → gave-up at 10|poll`, `error → poll(note=failure.message)`; `decideTick` deleted and `session/index.ts` dispatches on `plan.kind` with no reason if-chain; `test/recorder-tick.test.ts` replaced by `test/plan-tick.test.ts` — 6 reasons × 4 fact sets = 24 rows + `stopRequested` precedence, 9-is-not-10, and one-shot-without-recording edges; post-recording `check_alive` re-check preserved — [parallel-safe: no, needs: #30]
- [x] #32 D — `AbortScope`, `RecordingJob`, 16 → 4 events, `TikTokError.code` 11 → 5, CLI handlers, CHANGELOG `BREAKING` — done — evidence: `bun run lint` 0/5, `bun run typecheck` 0, `bun test` 135 pass/0 fail/232 expects/13 files, `bun run build` 0; `session/abort.ts` is the only controller, signal threaded through `HttpClient`, Webcast/page fetches, converter, stream download, and poll sleep — synthetic in-flight HTTP abort smoke: `bun /tmp/abort-smoke.ts` → `{"result":"aborted","elapsedMs":51}` exit 0 (target <500 ms); `session/job.ts` owns idempotent `finish()` and deletes `post-processing.ts` + `pendingRemuxes`; segmenting now reads ffmpeg `-segment_list pipe:1 -segment_list_type csv`, `test/job.test.ts` pins conversion events, `_partN` names, CSV durations, and utimes; events are exactly `verdict`, `record`, `progress`, `failure` (16 removed incl. the empty `recording:end` handler); `TikTokError.kind` → `.code` with only config-error/ffmpeg-not-found/ffmpeg-error/aborted/unknown and `AppErrorKind` deleted; `LiveInfo`/`toLiveInfo`/`getLiveInfo` deleted; versions 0.14.0 (both packages + bun.lock) and CHANGELOG has `## [0.14.0]` + `### BREAKING`; `bun packages/cli/dist/bin.mjs --help` prints the same surface with `tokrec/0.14.0`; CLI uses 4 subscriptions (one per event channel), `ui.ts` untouched — [parallel-safe: no, needs: #31]

Gate for each: `bun run lint && bun run typecheck && bun test && bun run build` all exit 0, plus the ticket-specific evidence named in its issue. Do not start B before A's guardrail test is green.
