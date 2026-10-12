# Tickets — split tokrec into lib + cli bun workspaces

Spec: `.crew/spec.md` · ADR: `.crew/adr/001-split-lib-and-cli-into-bun-workspaces.md`. All tickets run in `/home/envs4/workspaces/tokrec`. After the run, at the user's request: `HANDOFF.md` deleted (`git rm`, staged) and `.rail/` (PROJECT.md, ROADMAP.md, STATE.md, empty phases/) removed.

## Ledger

- [x] t1 scaffold workspace manifests + tsconfig base (smith) — done — evidence: root `tokrec-monorepo` private/workspaces `packages/*`, lib `@zfadhli/tokrec` (no bin, no ./cli, bun condition, files dist+src), cli `@zfadhli/tokrec-cli` (bin tokrec), `tsconfig.base.json` customConditions ["bun"], link `packages/cli/node_modules/@zfadhli/tokrec → ../../../lib`; deviation accepted: package tsconfigs extend `../../tsconfig.base.json` (ticket brief had a wrong one-level path). Side note: `HANDOFF.md` was missing from the worktree after this wave; t1's command log shows no deletion, no backup existed, its uncommitted edits are unrecoverable — restored HEAD version (`git checkout -- HANDOFF.md`).
- [x] t2 move files with git mv (smith) — done — evidence: `38 files changed, 0 insertions(+), 0 deletions(-)`, root `src/`+`test/` gone; verified: lib src = core+index+lib{config,logger,utils}, cli src = bin,browser-cookies,cli,tmux,ui; cli test = cli,browser-cookies. `HANDOFF.md` intact.
- [x] t3 rewrite cli imports + widen lib public API (smith) — done — evidence: lib index.ts now exports value `TikTokError` + `LogLevel` type + 4 utils; cli cross-package imports are public-entry only (`rg '@zfadhli/tokrec' packages/cli/src` = 5 lines); `rg 'bun:sqlite|koko-cli' packages/lib` empty; `bun test packages/lib` 47 pass, `bun test packages/cli` 24 pass; both typechecks exit 0. Orchestrator fix during reconcile: `tsconfig.base.json` `types: ["bun-types"]` → `["bun"]` (root cause: bun-types is not hoisted in this workspace → TS2688 in both packages, pre-existing but gate-blocking).
- [x] t4 per-package tsdown configs (smith) — done — evidence: `packages/lib/tsdown.config.ts` (entry src/index.ts, dts true), `packages/cli/tsdown.config.ts` (entry src/bin.ts, dts false), root config `git rm`'d; both builds exit 0; `head -1 packages/cli/dist/bin.mjs` = `#!/usr/bin/env bun`; lib dist has index.mjs/index.d.mts/core/lib.
- [x] t5 CI + publish workflows (smith) — done — evidence: ci.yml = `biome ci packages/` + `bun run typecheck` + `bun test` + `bun run build`; publish.yml = `bun run build`, `npm publish --workspace packages/lib` then `--workspace packages/cli` (lib first), release glob `packages/*/dist/**`; lefthook needed no change. Orchestrator fix: root `biome check packages/` surfaced 13 errors that old `src/`-scoped lint never saw — added `!**/test/fixtures` to biome.json includes (captured HTML is not source) and ran `biome check --write packages/` (8 files formatted/organizeImports); `bun run lint` now 0 errors, 5 pre-existing warnings (`noNonNullAssertion` in tiktok-api.test.ts).
- [x] t6 repoint dev script (smith) — done — evidence: `FIXTURE_DIR` → `packages/lib/test/fixtures/tiktok`, dynamic imports → `packages/cli/src/browser-cookies.ts`, `packages/lib/src/core/api/{client,tiktok}.ts` (stale `src/api/*` fixed too); script not executed (needs live cookies/network).
- [x] t7 README install commands (smith) — done — evidence: L58 `npm install -g @zfadhli/tokrec-cli`, L70 `npx @zfadhli/tokrec-cli -u username`; library examples untouched.
- [x] t8 CHANGELOG breaking entry (smith) — done — evidence: `## Unreleased` above latest release with 3 bullets: package split, `./cli` subpath + deep imports removed (breaking, pre-1.0), CLI commands now `@zfadhli/tokrec-cli`; only CHANGELOG.md modified.
- [x] t9 full green gate + pack shape (smith) — done — evidence (orchestrator re-verified): lint 0 errors/5 pre-existing warnings, both typechecks exit 0, `bun test` 71 pass, both builds exit 0; lib pack 58 files = `dist/**` + `src/**` incl `src/index.ts` + package.json, zero `test/` entries; cli pack 13 files = `dist/**` + package.json only; no stray `.tgz`. Caveat on criterion 4: `bun run packages/cli/dist/bin.mjs --version` prints `tokrec/0.13.0 linux-x64 bun-v26.3.0` then exits 1 with `<user> is required (--user or -u)` — `createCLI(version)` does not halt and `parseArgs` leaves the result undefined; code path byte-identical at HEAD (pre-existing, split-independent), left unfixed under "no behavior changes".
- [x] t10a spec-axis review (sage) — done, wrapped at turn limit — verdict: faithful, **no criticals**; C1,C3,C4-auto,C5–C10 pass; C4 fail-as-written (MAJOR, pre-existing `--version` exit 1, pre-existence independently confirmed against HEAD); publish path sound (`workspace:^` rewrite at pack time, lib-first ordering correct); all out-of-scope diffs ticket-explained.
- [x] t10b standards-axis review (scout) — done — no criticals, no debris/secrets; both orchestrator fixes confirmed as root-causes (fixture ignore scoped to captured data only); 5 lint warnings pre-existing; fresh `bun install && bun run build` passes. MINORs: `--version` (dupe of t10a), boundary-smoke-test coverage gap (out of scope per spec), stale comment in `scripts/capture-fixtures.ts:8` (fixed inline by orchestrator).

## Follow-ups (reported, not built — out of scope)

- `--version` exits 1: `packages/cli/src/cli.ts` runs `parseArgs` before cac's version handling; short-circuit would be a behavior change. Pre-existing at HEAD.
- No test covers the new boundaries (built bin shebang/`--version`, existence of the `bun` export target). Smallest useful test: spawn `packages/cli/dist/bin.mjs --version` and assert output + exit 0; spec excluded new tests.

Retro artifacts: `AGENTS.md` created at the repo root (layout, workspace invariants, agent working rules); `scripts/capture-fixtures.ts:8` comment corrected.

Parallel wave 1: t1. Wave 2: t2. Wave 3: t3. Wave 4: t4, t5, t6, t7, t8 (all independent files). Wave 5: t9. Wave 6: t10.

## Briefs

### t1 — scaffold workspace manifests

Create the workspace skeleton; touch no source files.

Root `package.json` — replace with: `name: "tokrec-monorepo"`, `private: true`, `type: "module"`, `workspaces: ["packages/*"]`, scripts: `dev: "bun run --cwd packages/cli src/bin.ts"`, `build: "bun run --cwd packages/lib build && bun run --cwd packages/cli build"`, `typecheck: "bun run --cwd packages/lib typecheck && bun run --cwd packages/cli typecheck"`, `test: "bun test"`, `lint: "biome check packages/"`, `lint:fix: "biome check --write packages/"`, `format: "biome format --write packages/"`. devDependencies: `@biomejs/biome ^2.5.0`, `lefthook ^2.1.9`, `tsdown ^0.22.3`, `typescript ^6.0.3`, `@types/bun latest`. No runtime dependencies at root. Keep `engines: { bun: ">=1.2" }`.

`packages/lib/package.json` — take the identity currently at the root: `name: "@zfadhli/tokrec"`, `version: "0.13.0"`, same description, `type: "module"`, `main: "./dist/index.mjs"`, `types: "./dist/index.d.mts"`, `exports: { ".": { "bun": "./src/index.ts", "types": "./dist/index.d.mts", "default": "./dist/index.mjs" } }` (no `./cli` subpath), `files: ["dist", "src"]`, no `bin`, scripts `build: "tsdown"`, `typecheck: "tsc --noEmit"`, dependencies `peaknorm ^0.7.0`, `wreq-js ^2.3.1`, `execa ^9.6.1`. Copy `license`, `repository`, `bugs`, `homepage`, `publishConfig.access: public` from the root manifest.

`packages/cli/package.json` — `name: "@zfadhli/tokrec-cli"`, `version: "0.13.0"`, description "TikTok live stream recorder CLI", `type: "module"`, `bin: { tokrec: "./dist/bin.mjs" }`, `files: ["dist"]`, no `exports`, no dts, scripts `build: "tsdown"`, `typecheck: "tsc --noEmit"`, dependencies `"@zfadhli/tokrec": "workspace:^"`, `@zfadhli/koko-cli ^0.2.1`, `execa ^9.6.1`, plus the same `license` / `repository` / `bugs` / `homepage` / `publishConfig`.

`tsconfig.base.json` — `git mv tsconfig.json tsconfig.base.json`, then remove `include`/`exclude` (compilerOptions only) and add `"customConditions": ["bun"]` to compilerOptions.

`packages/lib/tsconfig.json` and `packages/cli/tsconfig.json` — `{ "extends": "../tsconfig.base.json", "include": ["src", "test"], "exclude": ["dist", "node_modules"] }`.

Do not create `tsdown.config.ts` files yet (t4). Do not move source files yet (t2). `bun install` now regenerates `bun.lock` with workspace entries.

### t2 — move files

From the repo root, with `git mv` so history follows:

1. `mkdir -p packages/lib/src packages/cli/src packages/cli/test`
2. `git mv src packages/lib/src` — this puts all of `src` under lib first.
3. Move CLI-only modules out of lib: `git mv packages/lib/src/bin.ts packages/cli/src/bin.ts`; `git mv packages/lib/src/lib/cli.ts packages/lib/src/lib/ui.ts packages/lib/src/lib/tmux.ts packages/lib/src/lib/browser-cookies.ts packages/cli/src/`. `packages/lib/src/lib/` must end up containing exactly `config.ts`, `logger.ts`, `utils.ts`. Leave `packages/lib/src/core/**` and `packages/lib/src/index.ts` where they are.
4. `git mv test packages/lib/test`, then `mkdir -p packages/cli/test` (already made) and `git mv packages/lib/test/cli.test.ts packages/lib/test/browser-cookies.test.ts packages/cli/test/`. `packages/lib/test/` keeps `tiktok.test.ts`, `tiktok-api.test.ts`, `config.test.ts`, `logger.test.ts`, `utils.test.ts`, `fixtures/`, `utils/mock-http.ts`.

Nothing at the repo root `src/` or `test/` may remain. Do not edit file contents — imports break in this intermediate state on purpose; t3 fixes them.

### t3 — rewrite imports, widen lib API

Lib side, `packages/lib/src/index.ts`: keep the existing `createRecorder` export and type block, add value exports:

- `export { TikTokError } from "./lib/config"` (the class — today it is only re-exported via the type block, and the CLI needs `instanceof`)
- `export type { LogLevel } from "./lib/config"`
- `export { bytesToHuman, formatDuration, relativeTime, sanitizeUser } from "./lib/utils"`

CLI side. In `packages/cli/src/bin.ts`: `createRecorder` and the three formatting helpers (`bytesToHuman`, `relativeTime`) and `TikTokError` / `RecorderConfig` come from `"@zfadhli/tokrec"`; internal modules become `"./browser-cookies"`, `"./cli"`, `"./tmux"`, `"./ui"`. In `packages/cli/src/cli.ts`: `LogLevel` / `RecorderConfig` / `TikTokError` from `"@zfadhli/tokrec"`, `sanitizeUser` from `"@zfadhli/tokrec"`, `pkg` import `"../../package.json"` → `"../package.json"`. In `packages/cli/src/ui.ts`: `formatDuration` from `"@zfadhli/tokrec"`. `tmux.ts` and `browser-cookies.ts` have no cross-package imports — leave them.

Tests: `packages/cli/test/cli.test.ts` imports `parseArgs` from `"../src/cli"` and `RecorderConfig` from `"@zfadhli/tokrec"`; `packages/cli/test/browser-cookies.test.ts` imports from `"../src/browser-cookies"`. Lib tests need no edits (`../src/...` still resolves).

Resolution: bun reads lib's `"bun"` export condition → `./src/index.ts`, so no lib build is needed. tsc needs the same — that is what `customConditions: ["bun"]` in `tsconfig.base.json` is for. If `bun run --cwd packages/cli typecheck` still reports cannot-find-module for `@zfadhli/tokrec`, fall back to adding `paths: { "@zfadhli/tokrec": ["../lib/src/index.ts"] }` to `packages/cli/tsconfig.json` and report the deviation in your summary.

### t4 — tsdown configs

`packages/lib/tsdown.config.ts` — same shape as the current root config, entry `["src/index.ts"]`: `format: "esm"`, `clean: true`, `dts: true`, `sourcemap: true`, `target: "node20"`, `unbundle: true`.

`packages/cli/tsdown.config.ts` — entry `["src/bin.ts"]`, same flags **except** `dts: false` (bin-only, no consumers; dts would need lib's built types). `git rm tsdown.config.ts`.

Expected: lib dist has `index.mjs`, `index.d.mts`, sourcemaps; cli `dist/bin.mjs` line 1 is `#!/usr/bin/env bun` (tsdown preserves the shebang — if it is missing, report it, do not hand-patch). Build order lib → cli is enforced by the root script; cli's build has no real dependency on lib's dist.

### t5 — CI + publish workflows

`.github/workflows/ci.yml`: replace `bunx biome ci src/` with `bunx biome ci packages/`, `bunx tsc --noEmit` with `bun run typecheck`, `bun test` stays, `bunx tsdown` with `bun run build`.

`.github/workflows/publish.yml`: `bunx tsdown` → `bun run build`; replace the single `npm publish` step with two steps in this order — `npm publish --workspace packages/lib --provenance --access public` then `npm publish --workspace packages/cli --provenance --access public` (same `NODE_AUTH_TOKEN` env). Lib first is load-bearing: cli's `workspace:^` range must rewrite to a version that already exists on the registry. GitHub release `files:` → `packages/*/dist/**` and `LICENSE`.

`lefthook.yml` needs no edits — its globs are file-extension based and root scripts delegate. Confirm that by reading it; if a `glob`/`run` references a path that no longer exists, fix it.

### t6 — repoint dev script

`scripts/capture-fixtures.ts` currently references paths that were already stale pre-split. Rewrite: `FIXTURE_DIR` → `packages/lib/test/fixtures/tiktok`; `src/browser-cookies.ts` → `packages/cli/src/browser-cookies.ts`; `src/api/client.ts` → `packages/lib/src/core/api/client.ts`; `src/api/tiktok.ts` → `packages/lib/src/core/api/tiktok.ts`. `ROOT` stays the repo root. No behavior change beyond paths.

### t7 — README

CLI install commands only: `npm install -g @zfadhli/tokrec` → `@zfadhli/tokrec-cli`; the npx one-off `npx @zfadhli/tokrec …` → `npx @zfadhli/tokrec-cli …`. Library examples and every `import … from "@zfadhli/tokrec"` stay as they are (that name is still the library). Leave the npm badges as they are; do not restructure the README.

### t8 — CHANGELOG

Add an `## Unreleased` section at the top (above the latest release) stating: package split into `@zfadhli/tokrec` (library, programmatic API only) and `@zfadhli/tokrec-cli` (CLI, `tokrec` bin); the `./cli` subpath export and deep imports are removed (breaking, pre-1.0); CLI install/one-off commands now use the new package. Match the file's existing heading and bullet style — read its first 30 lines first.

### t9 — green gate

No edits. Run in order and capture output: `bun run lint`, `bun run typecheck`, `bun test`, `bun run build`, `bun run packages/cli/dist/bin.mjs --version` (expect `0.13.0`), `npm pack --dry-run --workspace packages/lib`, `npm pack --dry-run --workspace packages/cli`. Any failure is a real defect: report the command, its output, and the offending file rather than papering over it. In particular verify from the pack output that lib ships `dist/` **and** `src/` (the `bun` condition must resolve inside the published tarball) and that neither tarball contains test files.

### t10 — adversarial review

Read `.crew/spec.md`, the ADR, and the full diff (`git diff` against the pre-ticket HEAD plus untracked files). For each acceptance criterion 1–10, state pass/fail with the command that proves it. Try to refute the plan's claims rather than confirm them — specifically: does anything still import lib internals from cli beyond the public entry; does lib still reference `bun:sqlite` or `koko-cli`; does `packages/cli` accidentally build dts; would a fresh clone `bun install && bun run build` produce a publishable tarball; is the `bun` condition harmless for Node consumers. Report findings by severity; change nothing.
