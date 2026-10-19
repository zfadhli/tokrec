# @zfadhli/tokrec-cli

`tokrec` — records a TikTok live stream to MP4 from the terminal. Polls until the
user goes live, downloads the stream (FLV or HLS), and remuxes it with FFmpeg.

[![npm version](https://img.shields.io/npm/v/@zfadhli/tokrec-cli?style=flat-square)](https://www.npmjs.com/package/@zfadhli/tokrec-cli)
[![CI](https://img.shields.io/github/actions/workflow/status/zfadhli/tokrec/ci.yml?style=flat-square&label=CI)](https://github.com/zfadhli/tokrec/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/@zfadhli/tokrec-cli?style=flat-square)](https://github.com/zfadhli/tokrec/blob/main/LICENSE)

## Install

```bash
bun add -g @zfadhli/tokrec-cli   # then: tokrec -u <user>
bunx @zfadhli/tokrec-cli -u <user>
```

Requirements: **Bun ≥ 1.2** (the published entry point runs on Bun), **FFmpeg**
on `PATH`, and **tmux** only for background recording.

## Quick start

```bash
# Record a live stream (Ctrl+C to stop)
tokrec -u somebody

# Record for 10 minutes, split into 5-minute segments
tokrec -u somebody -d 10 -s 5

# Custom output directory and proxy
tokrec -u somebody -o ./videos -p http://127.0.0.1:8080

# Normalize loudness (EBU R128)
tokrec -u somebody --normalize
```

Output lands in the current directory (or `-o <dir>`) as
`<user>=YYYYMMDD_HHMMSS.mp4`; segments are `<name>_partN.mp4`. Ctrl+C stops
cleanly: the download aborts, the partial file is still converted to MP4.

## Commands

| Command | Purpose |
| --- | --- |
| `tokrec -u <user>` | Record in the foreground |
| `tokrec start -u <user>` | Record inside a tmux session; survives terminal close |
| `tokrec stop [-u <user>]` | Stop one background session, or all of them |
| `tokrec status [-u <user>]` | List running background sessions |
| `tokrec setup` | Check cookie status, or create `cookies.json` interactively |

Background sessions are named `tokrec-<user>`; reattach with
`tmux attach -t tokrec-<user>` and detach with `Ctrl+B`, `D`.

## Options

`-u, --user <name>` is required for recording; it can also be passed as the
first argument.

| Flag | Default | Meaning |
| --- | --- | --- |
| `-o, --output <dir>` | `.` | Output directory |
| `-i, --interval <minutes>` | `3` | Polling interval |
| `-d, --duration <minutes>` | unlimited | Max recording duration |
| `-s, --segment-minutes <minutes>` | off | Split the recording into segments of this length |
| `-p, --proxy <url>` | — | HTTP proxy, e.g. `http://127.0.0.1:8080` |
| `-l, --log-level <level>` | `info` | `debug`, `info`, `warn`, `error` |
| `-c, --cookies <path>` | `./cookies.json` | Path to a cookies file |
| `--normalize` | off | Normalize audio loudness (EBU R128) |
| `--normalize-loudness <num>` | `-14` | Target loudness in LUFS |
| `--normalize-codec <name>` | `libopus` | Audio codec for normalized output |
| `--normalize-bitrate <str>` | `96k` | Audio bitrate for normalized output |
| `--rate <n>` | `5` | Max API requests per second; `0` disables the limiter |
| `--debug` | off | API debug logging on stderr |

`-d` and `-s` take **minutes**. Both are rejected if they are not numbers ≥ 0.

## Authentication

TikTok only serves some streams to logged-in sessions.

- **Firefox (automatic)** — `tokrec` reads `sessionid_ss` and the Slardar WAF
  cookie from Firefox's cookie store when it exists. No configuration needed.
- **`cookies.json`** — pass `-c path/to/cookies.json`. The file must contain at
  least `sessionid_ss`; other TikTok cookies may be included.

Age-restricted lives need an account that is allowed to view them.

## Links

- [Library package](https://www.npmjs.com/package/@zfadhli/tokrec) — same engine, embeddable
- [Repository](https://github.com/zfadhli/tokrec) · [Changelog](https://github.com/zfadhli/tokrec/blob/main/CHANGELOG.md)
- [MIT License](https://github.com/zfadhli/tokrec/blob/main/LICENSE)
