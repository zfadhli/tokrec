# 001 — Split lib and CLI into bun workspaces

## Context

`@zfadhli/tokrec` shipped one package serving two audiences: programmatic consumers (`createRecorder` + types, `exports["."]`) and terminal users (`tokrec` bin via `exports["./cli"]`). The CLI reached into six non-public symbols (`TikTokError` as a class, `sanitizeUser`, `bytesToHuman`, `relativeTime`, `formatDuration`, `LogLevel`), and CLI-only modules (`cli.ts`, `ui.ts`, `tmux.ts`, `browser-cookies.ts`) sat in the same `src/lib/` directory as shared ones (`config.ts`, `logger.ts`, `utils.ts`). Neither audience had a boundary it could rely on.

## Decision

Split into two bun-workspace packages under a private root:

- `packages/lib` — `@zfadhli/tokrec`: `src/core/**` + `src/lib/{config,logger,utils}.ts`. `exports["."]` only; `./cli` removed (breaking, 0.x). `index.ts` gains value export `TikTokError` and public `sanitizeUser` / `bytesToHuman` / `relativeTime` / `formatDuration` / `LogLevel`.
- `packages/cli` — `@zfadhli/tokrec-cli`, bin `tokrec`: `bin.ts`, `cli.ts`, `ui.ts`, `tmux.ts`, `browser-cookies.ts`. Depends on `@zfadhli/tokrec: workspace:^`, so lib drops `bun:sqlite`.
- Lockstep versions: one `v*` tag releases both; `--version` reads cli's own package.json.
- In-repo resolution: lib `exports` carries `"bun": "./src/index.ts"` and `files: ["dist", "src"]`, so dev, tests, and cli typecheck read source; npm/Node consumers get `dist`. Root `build` builds lib then cli explicitly (cli's dts needs lib's dist). Shared `execa` hoists to the root.

## Consequences

- The published boundary is now real: cli can only use lib's public entry, and the widened surface is a semver commitment.
- `exports["./cli"]` and deep imports break for existing consumers; noted in the changelog.
- Root tooling must learn the layout: `biome ci src/` → `biome ci packages`, root tsconfig becomes a compilerOptions-only base, ci/publish workflows use the delegated root scripts, release artifacts glob `packages/*/dist/**`, and `capture-fixtures.ts` targets `packages/lib/test/fixtures`.
- Publish order is load-bearing: lib before cli, or `workspace:^` has no version to rewrite to.

## Rejected

- **Root stays lib, add `packages/cli`** — bun refuses `workspace:*` against the root package (`error: Workspace dependency "root-pkg" not found`, `Searched in "./*"`), so cli would face a stale published lib or a source path alias.
- **Three-package split with a shared internals package** — 3.1k LOC; a third publish target and version surface with no payoff.
- **Changesets / independent versioning** — lib and cli ship together; machinery exceeds the need.
- **Bundling lib into cli's dist** — hides the boundary instead of defining it, and still needs build ordering.

## Rename note (2026-10-14)

The directory was later renamed `packages/lib` → `packages/tokrec` so the path matches the package it holds (`@zfadhli/tokrec`). Package names, exports, publish order, and behavior are unchanged; this record keeps the original path as written.
