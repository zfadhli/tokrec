# Glossary

- **lib package** — `packages/lib`, published as `@zfadhli/tokrec`. The recorder engine and programmatic API (`createRecorder`, config, logger, utils). Has no knowledge of the terminal.
- **cli package** — `packages/cli`, published as `@zfadhli/tokrec-cli`, installs the `tokrec` bin. Terminal frontend: arg parsing, display, tmux, cookie extraction.
- **workspace root** — the private root package. Owns tooling only (biome, lefthook, base tsconfig, scripts); publishes nothing.
- **bun export condition** — the `"bun"` entry in a package's `exports` map pointing at `./src/index.ts`. Bun resolves it in-repo for dev/tests/typecheck; npm and Node consumers get `dist`.
- **lockstep versioning** — one `v*` tag releases both packages at the same version; cli depends on lib via `workspace:^`.
