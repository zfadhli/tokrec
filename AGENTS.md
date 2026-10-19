# AGENTS.md — tokrec

Bun workspace. Read this before changing layout, publishing, or delegating.

## Layout

- `packages/tokrec` — `@zfadhli/tokrec`, library only: `src/core/**` (pure), `src/io/**` (network/disk/process), `src/app/**` (orchestration), public API re-exported from `src/index.ts`.
- Bands are enforced, not aspirational: `packages/tokrec/test/architecture.test.ts` fails on a cross-band import, on any `node:*`/`bun:*` import reachable from `core/`, on an import cycle, or on a barrel that exports from outside `core/`+`app/`. `io/` may import `core/` and `io/`; `app/` may import all three; `core/` imports only itself. Type-only edges are exempt.
- `packages/cli` — `@zfadhli/tokrec-cli`, `bin: tokrec`: `src/{bin,cli,ui,tmux,browser-cookies}.ts`. May import the lib **only** through `@zfadhli/tokrec` — never a lib internal path.
- Root — private; owns tooling only (`biome.json`, `lefthook.yml`, `tsconfig.base.json`, scripts, workflows).
- `packages/tokrec/src/io/tiktok/discovery/` — three files: `chain.ts` (candidate types, constructor helpers, `discover()`), `page.ts` (SIGI page source plus its legacy fallback), `fallback.ts` (api-live + profile sources). Internal only — not a public extension point; pure parsing lives in `io/tiktok/parse.ts`, Webcast endpoints in `io/tiktok/webcast.ts`, page fetching in `io/tiktok/page.ts`. Keep discovery files under 150 LOC.

Run everything from the root: `bun run lint`, `bun run typecheck`, `bun test`, `bun run build`. The build chain is explicit: lib, then cli. `bun test` discovers tests in both packages.

## Workspace invariants

- Lib `exports` carries `"bun": "./src/index.ts"` and `files: ["dist", "src"]`. Those stay in sync: Bun resolves the condition in-repo *and* for published Bun users, so `src/index.ts` must ship in the tarball. Do not drop `src` from `files`.
- `tsconfig.base.json` uses `types: ["bun"]`. `bun-types` fails with TS2688 here because it is not hoisted — do not switch back.
- `packages/cli` builds with `dts: false` (bin-only). Do not add dts to it.
- Publish order is load-bearing: `packages/tokrec` before `packages/cli` — the cli's `workspace:^` range rewrites to a version that must already exist on the registry.
- `packages/*/test/fixtures` holds captured TikTok HTML/JSON. It is excluded from Biome (`!**/test/fixtures`) — never format, lint-fix, or "tidy" it; tests parse the raw bytes.

## Working rules for agents

- Do exactly the ticket's file list. Never run state-changing git commands (`checkout`, `reset`, `clean`, `rm`, `git mv` beyond the ticket) outside it — an unexplained deletion in `git status` is a CRITICAL finding, report it rather than continuing.
- Before marking done, show evidence: the command, its exit status, and the relevant output. A claim without a command is not done.
- `--version` on the built bin exits 1 (`tokrec/0.13.0` then `<user> is required`) — pre-existing in `parseArgs`; do not "fix" it as part of unrelated work.
