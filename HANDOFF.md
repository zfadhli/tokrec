# Handoff

## Goal

Release v0.12.0 (tmux, execa, setup) and v0.12.1 (cleanup, security) for @zfadhli/tokrec.

## Session Info

- **Branch:** `main`
- **Project:** `@zfadhli/tokrec` (TikTok live stream recorder)
- **Saved:** 2026-07-05

## Changes

```
?? tiktok-recorder.log.1
?? tiktok-recorder.log.2
?? tiktok-recorder.log.3
```

No uncommitted changes. Working tree clean.

## Files Touched

| File | Status | Done | Left |
|------|--------|------|------|
| `src/lib/tmux.ts` | new | Per-user tmux session helpers (start/stop/status) | — |
| `src/lib/cli.ts` | modified | Added start/stop/status/setup subcommands, removed positional username | — |
| `src/bin.ts` | modified | Command dispatch for tmux + setup, per-user session output | — |
| `src/core/recorder/convert.ts` | modified | Replaced node:child_process.spawn with execa | — |
| `src/core/recorder/ffmpeg-utils.ts` | modified | Replaced spawn with execa (streaming preserved) | — |
| `src/core/recorder/index.ts` | modified | Replaced spawn with execa | — |
| `test/cli.test.ts` | modified | Updated for CLIResult union type | — |
| `CHANGELOG.md` | modified | Added v0.12.0 and v0.12.1 sections | — |
| `README.md` | modified | tmux docs, subcommands table, setup docs, auth quick setup | — |
| `package.json` | modified | execa dependency, version bumps | — |
| `cookies.example.json` | new | Placeholder cookie values for users | — |
| `.gitignore` | modified | Added .opencode/, cookies.json | — |

## Key Decisions

- **execa over node:child_process.spawn**: Promise-based API, auto stderr capture, throws on non-zero exit. Cut ~25 lines per spawn site.
- **Per-user tmux sessions (tokrec-{user})**: Each user gets independent session. Allows concurrent recordings without recorder refactor.
- **Positional username removed**: `tokrec <user>` dropped. Only `tokrec -u <user>` works. Cleaner CLI.
- **cookies.json purged from git history**: Public repo had real cookie values. Used `git filter-repo` to rewrite history. Added cookies.example.json.
- **v0.12.0 minor bump**: 3 feat commits (tmux, execa, setup) warranted minor. v0.12.1 patch for cleanup.

## Dead Ends

- koko-cli subcommand parsing: `extractPositional` was stealing `start` from argv, breaking subcommand detection. Fixed by skipping positional extraction for known subcommands.

## Blockers

- None. All releases shipped, working tree clean.

## Next Steps

- [ ] Rotate the old `sessionid_ss` cookie — it was exposed in git history before rewrite
- [ ] Consider inline recorder-state.ts + recorder-events.ts into core/recorder/index.ts (carried from v0.11.5 handoff)
- [ ] Consider fixing ./cli subpath export to point to CLI parser instead of full binary

## Suggested Skills

- none — session complete, no pending work
