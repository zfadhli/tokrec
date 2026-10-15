# Glossary

- **tokrec package** — `packages/tokrec`, published as `@zfadhli/tokrec`. The recorder engine and programmatic API (`createRecorder`, config, logger, utils). Has no knowledge of the terminal.
- **cli package** — `packages/cli`, published as `@zfadhli/tokrec-cli`, installs the `tokrec` bin. Terminal frontend: arg parsing, display, tmux, cookie extraction.
- **workspace root** — the private root package. Owns tooling only (biome, lefthook, base tsconfig, scripts); publishes nothing.
- **bun export condition** — the `"bun"` entry in a package's `exports` map pointing at `./src/index.ts`. Bun resolves it in-repo for dev/tests/typecheck; npm and Node consumers get `dist`.
- **lockstep versioning** — one `v*` tag releases both packages at the same version; cli depends on lib via `workspace:^`.
- **restricted LIVE** — a TikTok live room that only plays for an entitled authenticated session (18+/age-gated or subscriber-only). The Webcast room-info endpoint refuses with `status_code 4003110` and no playable stream URL; `check_alive` still returns true, which distinguishes it from offline. tokrec reports it as `reason: "restricted"`, never a false offline.
- **room source** — one resolution phase behind the `RoomSource` interface (`core/api/resolvers/*`): page/SIGI, api-live, profile. Internal only; not a public extension point.
- **source chain** — the ordered `RoomSource[]` in `createTikTokApi`; first non-null `LiveInfo` wins, a thrown error aborts the chain, an internally caught error lets the next source run.
- **parity gate** — the requirement that a refactor leaves every `LiveInfo.source`/`LiveReason` outcome and `lastFetchHadError` transition identical to the base commit.
