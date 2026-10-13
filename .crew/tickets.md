# Tickets — honest LIVE status reporting (age-protected / restricted rooms)

Spec: `.crew/spec.md` · Evidence: `.crew/research/age-protected-live-evidence.md` · All tickets run in `/home/envs4/workspaces/tokrec`. Supersedes the workspace-split ledger, whose tickets are archived in git at `166f7af`.

## Ledger

- [x] t1 room/info + page reason taxonomy (smith) — done — evidence: `bun test packages/tokrec/test/tiktok-api.test.ts` 18 pass/0 fail; fixture `room-info-restricted.json` byte-exact; diff 4 files +362/-36 (tiktok.ts, config.ts, index.ts, test); duplicated 4003110→check_alive block at tiktok.ts:226,407,521,615 — flagged for t9 — [parallel-safe: no, needs: none]
- [x] t2 unconditional `api-live` fallback + mapping (smith) — done — evidence: `bun test packages/tokrec/test/tiktok-api.test.ts` 20 pass/0 fail; `resolveRefusedRoom` defined tiktok.ts:474 and called 4x (227,387,499,574); `html.length < 5000` now only in the tryFetchPage WAF heuristic (146) — [parallel-safe: no, needs: t1]
- [x] t3 recorder decision from reason + tick payload (smith) — done — evidence: `bun test packages/tokrec` 58 pass/0 fail; `decideTick` recorder/index.ts:26; tick payload reason config.ts:90; restricted tick logs status_code 4003110 + source, `isLive:true` — [parallel-safe: no, needs: t1]
- [x] t4 CLI restricted/no-stream display (smith) — done — evidence: `bun run typecheck` 0 + `bun test packages/cli` 26 pass/0 fail; ui.ts `lock` tag:20, `userRestricted`:144, `userLiveNoStream`:152; bin.ts branches :186,:188; no git commands in transcript — [parallel-safe: yes, needs: t3]
- [x] t5 capture script takes usernames + api-live JSON (smith) — done — evidence: `bun run scripts/capture-fixtures.ts --help` exit 0 with usage; `bun run typecheck` exit 0; diffstat 1 file +111/-68, fixtures untouched — [parallel-safe: yes, needs: none]
- [x] t6 README + CHANGELOG note (smith) — done — evidence: README.md:224-228 "Age-protected / restricted LIVES" block, CHANGELOG.md:15 Unreleased bullet; `rg -n 'age-protected' README.md CHANGELOG.md` exit 0; diffstat 2 files +5 lines, no scope creep — [parallel-safe: yes, needs: none]
- [x] t7 full green gate (smith→orchestrator) — done — evidence: lint=0 (after `lint:fix` on 3 files for formatter/organizeImports violations from t1–t4; 5 pre-existing `noNonNullAssertion` warnings), typecheck=0, test=0 (84 pass/0 fail/134 expects), build=0; deviation: orchestrator ran the gate inline (pure verification). Re-verified after t11: lint=0, typecheck=0, test=0 (85 pass/0 fail/137 expects), build=0 — [parallel-safe: no, needs: t1,t2,t3,t4,t5,t6]
- [x] t8 spec-axis review (sage) — done — verdict: pass-with-minors, no criticals; gate reproduced (84 pass, lint 0, typecheck 0, build 0, capture --help 0); criteria 1–10 hold; minors: (a) `packages/cli/test/ui.test.ts` untracked → staged via t10, (b) `reason:"error"` wired only for page-fetch catch → t11, (c) live-tick log omits reason/source → t11, (d) post-recording tick reason undefined (inherited, not regression) → t11 — [parallel-safe: no, needs: t7]
- [x] t8 delta re-verify after t11 (sage) — done — all three minors closed, no new findings: error flag set only on exception paths (404/500/empty return before catches; flag reset per tick at tiktok.ts:164; non-null result short-circuits), new test hits :415 branch; criterion 7 edits good; residual nit: recorder/index.ts:218 offline log lacks reason (not charged)
- [x] t10 remove accidentally tracked recording + ignore mp4s — done — evidence: deleted `packages/cli/dominicteng2=20261012_205540.mp4` (2.4MB, tracked by 166f7af) and untracked `packages/cli/floradegreytta=20261013_084546.mp4` (47MB); `.gitignore:37 *.mp4`; `git ls-files | rg '\.mp4$'` empty; `git check-ignore -v` matches; staged: `M .gitignore`, `D …dominicteng2…mp4`, `A packages/cli/test/ui.test.ts` (nothing committed) — (user/orchestrator) [parallel-safe: yes, needs: none]
- [x] t11 close spec-gap minors from t8 — done — evidence: `lastFetchHadError` now at tiktok.ts:269,331,415,450; live log names reason+source recorder/index.ts:161; post-recording tick `reason:"offline"` :219; `bun test packages/tokrec` 59 pass/0 fail (+1 error-reason test); `bun run lint` exit 0; no git commands — [parallel-safe: no, needs: t8]
- [x] t9 standards-axis review (scout) — done — evidence: 7 fixtures byte-match HEAD (`cmp` exit 0), fixture diff = 100% renames + new restricted fixture; index 35 `packages/tokrec` paths, no `packages/lib` left; symlink resolves `../../../tokrec`; `package.json`/`publish.yml` order + `files`/`exports` intact; cli imports only `@zfadhli/tokrec`; no debug debris; tests assert behavior. Scope finding ("candidate probing") = false positive: `findStreamUrlRecursively` comment/arrays exist at HEAD (`git show HEAD:packages/lib/src/core/api/tiktok.ts:522,545`). High finding → t10 — [parallel-safe: yes, needs: t7]
- [ ] t10 remove accidentally tracked recording + ignore mp4s — status: pending user approval — paths: `packages/cli/dominicteng2=20261012_205540.mp4` (tracked since 166f7af: Bin 0→2462937), `.gitignore` — verify: `git ls-files | rg '\.mp4$'` empty and `git check-ignore -v 'packages/cli/floradegreytta=*.mp4'` matches — (user/orchestrator) [parallel-safe: yes, needs: none]

## Briefs

Read each file before editing it. Tests use `bun:test`. Never format or edit `packages/*/test/fixtures/**` (Biome-excluded, raw bytes).

### t1 — room/info + page reason taxonomy

Interface delta: `packages/tokrec/src/lib/config.ts` gains `export type LiveReason = "live" | "offline" | "restricted" | "no-stream-url" | "no-room-id" | "error"`. `packages/tokrec/src/core/api/tiktok.ts` `LiveInfo` gains `reason: LiveReason` and `source: string`, and is exported. `TikTokApi` gains `getLiveInfo(user: string): Promise<LiveInfo>` (additive; keep `getRoomId`, `isRoomAlive`, `getLiveUrl`, `invalidateCache` exactly as they are). `packages/tokrec/src/index.ts` exports type `LiveReason`.

- Populate `reason`/`source` at every `LiveInfo` return in `tiktok.ts` (SIGI primary `source:"sigi"`, SIGI legacy `"sigi"`, `fetchLiveInfoFromApi` `"api-live"`, `fetchRoomInfoFromRoomApi` `"room-info"`, `fetchLiveInfoFromProfile` `"profile"`).
- `fetchFromRoomApi` currently swallows `status_code === 4003110` (`tiktok.ts:316`). Change it to report the status instead of silently returning `null` — return a discriminated result (`{ ok: true; value: T } | { ok: false; statusCode: number; body: string }`) or an equivalent minimal change; callers map failures.
- On `4003110` with a known roomId, call `fetchCheckAlive(roomId)` before concluding: `alive === true` → `reason: "restricted"`, `isLive: true`, `streamUrl: null`; `alive === false` → `reason: "offline"`, `isLive: false`.
- `getLiveInfo(user)` returns the per-tick cached info; a total discovery failure returns `{ roomId: null, isLive: false, streamUrl: null, title: null, reason: "no-room-id" | "error", source: "none" }` (`"error"` when a caught exception/network failure was the cause).
- Add fixture `packages/tokrec/test/fixtures/tiktok/room-info-restricted.json` with the exact verbatim body observed in the evidence file (one line, no reformatting).
- Tests in `packages/tokrec/test/tiktok-api.test.ts` using `createMockHttp`/`loadFixture` (read the file first, follow its patterns): (a) `/live` SIGI HTML with `streamData` absent + `room/info` restricted fixture + `check_alive` `alive:true` → `getLiveInfo` gives reason `restricted`, roomId set, streamUrl null; (b) same but `check_alive` offline → reason `offline`; (c) healthy `anomaliaa27-live.html` + `anomaliaa27-room-info.json` → reason `live` and a `.flv`/`.m3u8` streamUrl.

### t2 — unconditional `api-live` fallback + mapping

Interface delta: none beyond t1.

- `tiktok.ts:187` gates `/api-live/user/room/` behind `!html || html.length < 5000`. Restructure `fetchLiveInfo` so that endpoint is called whenever the page/SIGI/universal-data paths produced no roomId, regardless of page size. Suggested order after the SIGI block: universal-data-from-html (if roomId) → `/api-live/user/room/` → profile-page fallback.
- In `fetchLiveInfoFromApi`: `status === 2` → try `fetchStreamUrlFromApi`; if that reports `4003110` and `check_alive` is true → reason `restricted` (source `api-live`); no URL and not restricted → `no-stream-url`; `status !== 2` → `offline`, `isLive:false`, keep the roomId.
- Tests in `packages/tokrec/test/tiktok-api.test.ts`: (a) a >5000-byte `/live` page with no SIGI/roomId → assert the api-live URL was fetched and its roomId is returned (the mock returns 404 for unregistered URLs, so registering only the api-live URL proves the call); (b) api-live `status:4` with roomId → reason `offline`.

### t3 — recorder decision from reason + tick payload

Interface delta: `packages/tokrec/src/lib/config.ts` `RecorderEventHandler["tick"]` payload becomes `{ user: string; isLive: boolean; roomId?: string; reason?: LiveReason }` (additive). `packages/tokrec/src/core/recorder/index.ts` exports `decideTick(info: LiveInfo): { isLive: boolean; reason: LiveReason }` where `isLive` is true for `live`, `restricted`, `no-stream-url`, false otherwise.

- `onTick` currently calls `getRoomId` then `getLiveUrl` and emits `isLive:false` for both "offline" and "live but no stream URL" (`recorder/index.ts:115-133`). Replace the verdict part with one `getLiveInfo(user)` call, branch: `restricted` → `logger.warn` including `reason` and raw status detail, `tick {isLive:true, reason:"restricted"}`, return; `no-stream-url` → warn `no stream URL found (reason)`, `tick {isLive:true, reason:"no-stream-url"}`, return; `offline`/`no-room-id`/`error` → `@user is offline` plus reason in the log, `tick {isLive:false, reason}`, return; `live` → existing recording path unchanged with `tick {isLive:true, reason:"live"}`.
- Keep `getNextUrl`/`isRoomAlive` refresh logic unchanged.
- New test `packages/tokrec/test/recorder-tick.test.ts` covering `decideTick` for all six reasons.

### t4 — CLI restricted/no-stream display

Interface delta: `packages/cli/src/ui.ts` `Display` gains `userRestricted(user: string): void` and `userLiveNoStream(user: string, roomId: string): void`.

- Add a `lock` tag next to the existing tags (`ui.ts:19` area) and render, matching existing style: `userRestricted` → `[LOCK] @user is live but age-protected/restricted — stream unavailable to this session`; `userLiveNoStream` → `[LIVE] @user (room: X) — no stream URL found`.
- `packages/cli/src/bin.ts:184` tick handler: branch on `info.reason === "restricted"` → `display.userRestricted`, `"no-stream-url"` → `display.userLiveNoStream`, else existing `isLive` branch.
- New test `packages/cli/test/ui.test.ts`: spy on `process.stdout.write`, call `createDisplay().userRestricted("x")`, assert output contains `age-protected`; same for `userLiveNoStream` containing `no stream URL`.

### t5 — capture script takes usernames + api-live JSON

- `scripts/capture-fixtures.ts` hardcodes `anomaliaa27`/`naylaarindinta`. Accept repeatable `--user <name>` and `--help` (print usage, exit 0). With no `--user`, keep the current default pair. For each user write `<user>-profile.html`, `<user>-live.html`, `<user>-api-live.json` (GET `https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=<name>&sourceType=54`), and `<user>-room-info.json` when a roomId is found. Keep the existing SIGI/universal-data extraction and `FIXTURE_DIR` path.
- Do not run it against a live account without cookies; verification is `--help` plus `bun run typecheck`.

### t6 — README + CHANGELOG note

- `README.md`, under Authentication after the WAF caution: a short "Age-protected / restricted LIVES" block — these appear as `[LOCK]`, the server returns `status_code 4003110` while `check_alive` is true, playback in the TikTok app does not transfer to the web session, and recording requires a web session (browser login) that can play the LIVE. No bypass promises.
- `CHANGELOG.md` Unreleased: bullet noting age-protected LIVES are now reported explicitly instead of offline/no-stream confusion.

### t7 — full green gate

Run from the repo root and report exit status plus counts: `bun run lint` (0 errors), `bun run typecheck` (both packages), `bun test` (existing 71 + new), `bun run build` (lib then cli). Fix only regressions introduced by t1–t6.

### t8/t9 — review gate

- t8 (sage, spec axis): does the diff satisfy `.crew/spec.md` acceptance criteria 1–10? Any missed criterion, unsupported claim, or behavior that still lies about status?
- t9 (scout, standards axis): repo conventions (`AGENTS.md`), tests actually exercise the new logic, no fixture tampering, no leaked debug debris, no scope creep beyond the spec's out-of-scope list.

Both report findings with file:line and a severity each; the orchestrator appends criticals as new tickets.
