# Spec — split tokrec into lib + cli bun workspaces

Source: approved design in this session; rationale and rejected alternatives in `.crew/adr/001-split-lib-and-cli-into-bun-workspaces.md`. Vocabulary in `.crew/GLOSSARY.md`.

## Problem

`@zfadhli/tokrec` is one package serving two audiences: programmatic consumers (`createRecorder` + types) and terminal users (`tokrec` bin). The CLI reaches into six non-public symbols and shares `src/lib/` with modules only one side uses. Neither audience has a boundary it can rely on; the CLI's `bun:sqlite` cookie extraction and `koko-cli` display code ship to every library consumer.

## Acceptance criteria

1. Layout is `packages/lib` (`@zfadhli/tokrec`) + `packages/cli` (`@zfadhli/tokrec-cli`, bin `tokrec`) under a private root; root `src/` and `test/` are gone; `bun.lock` tracks the workspaces.
2. `bun install` links `node_modules/@zfadhli/tokrec` → `packages/lib`.
3. From the root, `bun run lint && bun run typecheck && bun test && bun run build` all exit 0.
4. `packages/lib/dist/index.mjs` + `index.d.mts` exist; `packages/cli/dist/bin.mjs` exists, starts with `#!/usr/bin/env bun`, and `bun run packages/cli/dist/bin.mjs --version` prints `0.13.0`.
5. `npm pack --dry-run --workspace packages/lib` lists `dist/` and `src/`, and no `bin`; `--workspace packages/cli` lists `dist/` and `package.json` only.
6. Boundary holds: lib's `exports` has no `./cli`; `TikTokError` is importable as a **value** from `@zfadhli/tokrec`; `rg "bun:sqlite|koko-cli" packages/lib` finds nothing; `rg 'from "@zfadhli/tokrec"' packages/cli/src` is the only cross-package import form.
7. CI runs `biome ci packages/`, root typecheck, `bun test`, root build. Publish builds once, publishes lib **before** cli with `--workspace`, and the GitHub release globs `packages/*/dist/**`.
8. README CLI install/one-off commands point at `@zfadhli/tokrec-cli`; library examples still import `@zfadhli/tokrec`; CHANGELOG has an Unreleased entry naming the `./cli` export removal as breaking.
9. Every pre-existing test still passes with only import-path edits — no assertion changes.
10. `packages/cli` produces no dts (bin-only, no consumers).

## Interface deltas

- npm: `@zfadhli/tokrec` = lib only (drops `bin`, drops `exports["./cli"]`); new `@zfadhli/tokrec-cli` = CLI.
- lib `exports`: `{ ".": { "bun": "./src/index.ts", "types": "./dist/index.d.mts", "default": "./dist/index.mjs" } }`, `files: ["dist", "src"]`.
- lib `src/index.ts` adds value `TikTokError` and `sanitizeUser`, `bytesToHuman`, `relativeTime`, `formatDuration`, type `LogLevel`.
- cli deps: `@zfadhli/tokrec: workspace:^`, `@zfadhli/koko-cli`, `execa`; lib deps: `peaknorm`, `wreq-js`, `execa`; root holds tooling devDeps only.

## Out of scope

Behavior or CLI-surface changes; changesets / independent versions; CJS or Node-native builds; turbo/nx; a third shared-internals package; deprecating the old `./cli` subpath on npm; new tests beyond import repointing.
