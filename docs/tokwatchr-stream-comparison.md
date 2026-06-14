# Stream Architecture Comparison: tokrec vs tokwatchr

> **Source**: [`zfadhli/tokwatchr`](https://github.com/zfadhli/tokwatchr) (analyzed at commit `HEAD`)
>
> **Date**: 2026-06-14

---

## 1. AbortController Management

| Aspect | tokwatchr | tokrec |
|---|---|---|
| **Creation** | Single `AbortController` per `_run()` call, recreated on each `start()` | Single `AbortController` per `download()` call, reassigned on each call |
| **Propagation** | `signal` explicitly passed to **all** async operations (fetch, spawn, API calls) | Captured via closure in `abort()` and `waitForAbort()` / `abortPromise` |
| **External signal** | External `AbortSignal` (from options) wired via `addEventListener("abort", ..., { once: true })` | No external signal support |
| **Multiple start()** | Recreates controller + re-wires external signal (fixed in v0.6.4) | Works because `abortController` is reassigned in `download()` |

**tokwatchr pattern (simplified):**

```typescript
class TikTokLiveDownloader {
  private abortController = new AbortController();

  async _run() {
    this.abortController = new AbortController(); // fresh per run
    if (this.options.signal) {
      this.options.signal.addEventListener(
        "abort",
        () => this.abortController.abort(),
        { once: true },
      );
    }
    // Pass signal everywhere:
    await this.resolveRoomId(user, { signal: this.abortController.signal });
    await this.downloadWithFfmpeg(url, { signal: this.abortController.signal });
  }
}
```

**tokrec pattern (after our fixes):**

```typescript
function createStreamDownloader() {
  let abortController = new AbortController();

  async function download(...) {
    abortController = new AbortController(); // reassign per call
    // Single abortPromise created once before loop:
    const abortPromise = new Promise<never>((_, reject) => {
      abortController.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    });
    while (!abortController.signal.aborted) {
      await Promise.race([reader.read(), abortPromise]);
    }
  }
}
```

### Recommendation

Adopt tokwatchr's approach of **explicit signal propagation** to all async operations rather than relying on closure capture. This makes the abort path visible at every call site and enables composability with libraries that accept `AbortSignal`.

---

## 2. FFmpeg Subprocess Management

| Aspect | tokwatchr | tokrec |
|---|---|---|
| **Kill mechanism** | Node's built-in `spawn` `signal` option — auto-SIGTERM on abort | Manual `proc.kill("SIGTERM")` in `abort()` |
| **Reconnection** | FFmpeg `-reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5` flags | Custom JS reconnection loop with `tryReconnect()` + `getNextUrl()` |
| **Startup timeout** | `setTimeout` that kills if no stderr within `timeout` seconds (default 30) | None — relies on outer `timeout()` helper on `reader.read()` |
| **Progress parsing** | Parses FFmpeg stderr for `time=` and `speed=` to compute progress | Polls output file size via `statSync(filepath)` every 1 second |
| **Error handling** | Separates `AbortError` (from spawn signal) from real errors | Errors caught generically in catch block |

**tokwatchr — spawn with signal:**

```typescript
// src/download/ffmpeg.ts
const proc = spawn(ffmpegPath, ffmpegArgs, {
  signal,  // ← Node sends SIGTERM automatically on abort
  stdio: ["ignore", "pipe", "pipe"],
});

// No manual proc.kill() needed in abort path
```

**tokwatchr — reconnect flags:**

```typescript
const args = [
  "-reconnect", "1",               // enable reconnection
  "-reconnect_at_eof", "1",        // reconnect on EOF
  "-reconnect_streamed", "1",      // reconnect on stream error
  "-reconnect_delay_max", "5",     // max 5 sec between retries
  "-i", liveUrl,
  "-c", "copy",
  "-f", "mpegts",                  // write as MPEG-TS (crash-safe)
  outputPath,
];
```

### Recommendation

1. **Use Node's `spawn` `signal` option** — eliminates the need for manual `proc.kill()` and is strictly more reliable (Node handles the SIGTERM delivery race).
2. **Replace the JS reconnection loop with FFmpeg `-reconnect` flags** — FFmpeg's reconnect is battle-tested and handles transient network failures transparently, removing the need for `tryReconnect()` + `getNextUrl()`.
3. **Add a startup timeout** — prevents hanging on bad URLs.

---

## 3. Race Condition: Abort Detection in FFmpeg Close Handler

This is one of the most subtle and important differences.

| Aspect | tokwatchr | tokrec |
|---|---|---|
| **Detection method** | Synchronous `signal?.aborted` check in `close` handler | No FFmpeg close handler abort detection (abort via manual `proc.kill()` in `abort()` function) |
| **Race condition** | **None** — synchronous property check has no race | Potential race: `proc.kill()` triggers `close`, but async handlers may interleave |
| **Fix history** | v0.4.3: "fixed race condition in abort handling" | Not yet addressed |

**tokwatchr pattern (ffmpeg.ts close handler):**

```typescript
proc.on("close", (code) => {
  clearTimeout(firstDataTimer);

  if (signal?.aborted) {
    // Synchronous check — no race possible
    resolve({ sizeBytes, duration, format: "ts" });
    return;
  }

  if (code === 0) {
    resolve({ sizeBytes, duration, format: "ts" });
  } else {
    reject(new FfmpegError(`FFmpeg exited with code ${code}`, stderrBuffer));
  }
});
```

### Recommendation

Add a synchronous `signal?.aborted` check in all FFmpeg close handlers. This is strictly more reliable than relying on the async abort event listener, which can lose a race against the process exit.

---

## 4. Remux / Conversion on Abort

| Aspect | tokwatchr | tokrec |
|---|---|---|
| **Approach** | Background remux queue; `Promise.allSettled(pendingRemuxes)` in catch block | Inline conversion after download; catch block flushes buffer + closes write stream |
| **Concurrency** | Next segment downloads while previous segment remuxes | Serial — download then convert |
| **Abort behavior** | All pending remuxes finish before `stop()` resolves | Partial FLV is flushed and the write stream closed |
| **Output format** | `.ts` intermediate → remux to `.mp4` | Direct `.flv` → convert to `.mp4` |

**tokwatchr — pending remux tracking:**

```typescript
// TikTokLiveDownloader.ts
private pendingRemuxes: Promise<void>[] = [];

async downloadSegment(url): Promise<void> {
  const result = await downloadWithFfmpeg(url, { signal: ... });
  const remuxPromise = this.remuxAndNormalize(result.file)
    .then(() => this.emit("segment", ...));
  this.pendingRemuxes.push(remuxPromise);
}

// On error/abort:
catch (err) {
  await Promise.allSettled(this.pendingRemuxes); // let remuxes finish
  this.setState("done");
}
```

### Recommendation

Implement a `pendingRemuxes` queue with `Promise.allSettled()` in the catch/abort path. This ensures that segments already downloaded but not yet converted are not lost on Ctrl-C — they finish converting before the process exits.

---

## 5. Crash-Safe Intermediate Format

| Aspect | tokwatchr | tokrec |
|---|---|---|
| **Intermediate format** | MPEG-TS (`.ts`) — playable even mid-write | FLV (`.flv`) — also playable mid-write |
| **Final output** | Remux `.ts` → `.mp4` via FFmpeg `-c copy` | Convert `.flv` → `.mp4` via FFmpeg `-c copy` |
| **Deletion** | Deletes intermediate `.ts` after successful remux | Deletes intermediate `.flv` after successful conversion |

Both approaches are functionally equivalent for crash safety. The key insight from tokwatchr is the use of `-f mpegts` as the output format during download, which is a standard container that FFmpeg handles particularly well for live streams.

```typescript
// tokwatchr writes to .ts:
const args = [
  "-i", liveUrl,
  "-c", "copy",
  "-f", "mpegts",        // ← forces MPEG-TS output
  outputPath,            //    (extension .ts)
];
```

---

## 6. State Machine

| Aspect | tokwatchr | tokrec |
|---|---|---|
| **States** | `idle → waiting → recording → stopping → done` | `idle → polling → recording → converting → stopped` |
| **Stop detection** | Polls `setTimeout(check, 100)` until state is `"done"` | Direct — `stop()` calls `downloader.abort()` + `monitor.stop()` |
| **State transitions** | Set via `setState()` which also emits events | Set via `setState()` which updates a status object |
| **Reusability** | Full lifecycle per `start()`/`stop()` cycle | Single use (one `start()` per process) |

**tokwatchr's stop polling (potential hang risk):**

```typescript
async stop(): Promise<void> {
  if (this._state !== "recording" && this._state !== "waiting") return;
  this.setState("stopping");
  this.abortController.abort();
  // Poll until state becomes "done"
  await new Promise<void>((resolve) => {
    const check = () => {
      if (this._state === "done") resolve();
      else setTimeout(check, 100);
    };
    check();
  });
}
```

This pattern has a **no-timeout risk**: if `_run()` fails to set state to `"done"`, `stop()` hangs forever. tokrec's approach of directly calling abort + stop is simpler and doesn't have this issue.

### Recommendation

Keep tokrec's straightforward abort approach but add formal state machine transitions with `setState()` for better observability. Avoid polling-based stop detection.

---

## 7. Timer Hygiene

| Timer | tokwatchr | tokrec |
|---|---|---|
| **Duration limit** | `setTimeout` in `raw-http.ts` — **NOT cleared on abort path** (minor leak) | `setTimeout` in `timeout()` helper — properly cleared in `.then()` handlers |
| **FFmpeg startup** | `setTimeout` in `ffmpeg.ts` — cleared in `close` and `error` handlers | None |
| **Progress polling** | FFmpeg stderr parsing (no timer) | `setInterval` every 1s — cleared in `close` and `error` |
| **Stop polling** | `setTimeout(check, 100)` — never cleared, no timeout guard | None |
| **Sleep** | `setTimeout` in promise wrapper — self-cleaning | Same pattern |

### Recommendations for tokrec

- The `setInterval` for progress polling and `setTimeout` for maxDuration are already properly cleaned up in tokrec. ✅
- Consider adding a **startup timeout** for FFmpeg (kill if no stderr output within 30s).
- Avoid introducing polling-based patterns like tokwatchr's `stop()` polling.

---

## 8. Event Listener Cleanup

| Listener | tokwatchr | tokrec |
|---|---|---|
| **External signal** | `{ once: true }` — auto-cleanup on fire | Not applicable (no external signal support) |
| **process.on("SIGINT/SIGTERM")** | **Never removed** (CLI only, one-shot) | **Never removed** (same pattern) |
| **FFmpeg stderr.on("data")** | **Never explicitly removed** (freed when process exits) | **Never explicitly removed** (same pattern) |
| **Internal EventEmitter** | `on()`/`off()` API available | `on()`/`off()` API now available (added in our fixes) |

Both codebases have the same blind spot: CLI-level `process.on("SIGINT")` handlers are never cleaned up with `process.off()`. This is benign for one-shot CLI usage but would matter in programmatic reuse.

---

## Summary of Lessons for tokrec

| Priority | Lesson | Impact | Effort |
|---|---|---|---|
| 🔴 | **Use `spawn` `signal` option** instead of manual `proc.kill()` — eliminates race conditions | Reliability | Low |
| 🔴 | **Add synchronous `signal?.aborted` check** in FFmpeg close handlers | Reliability | Low |
| 🟡 | **Replace JS reconnect loop** with FFmpeg `-reconnect` flags | Simplicity, resilience | Medium |
| 🟡 | **Implement `pendingRemuxes` queue** with `Promise.allSettled()` on abort | Data safety | Medium |
| 🟢 | **Add startup timeout** for FFmpeg spawn | Robustness | Low |
| 🟢 | **Add state machine** with formal `setState()` transitions | Observability | Low |
| 🟢 | **Clean up `process.on("SIGINT")`** handlers via `process.off()` | API hygiene | Low |

---

## Source Files Examined

| File | Lines | Content |
|---|---|---|
| `src/TikTokLiveDownloader.ts` | 907 | Core orchestrator — lifecycle, state machine, event emitter |
| `src/download/ffmpeg.ts` | 301 | FFmpeg subprocess download with reconnect + signal integration |
| `src/download/raw-http.ts` | 150 | Raw HTTP FLV download with Web Streams API |
| `src/api/stream.ts` | 97 | Stream URL fetching and room alive check |
| `src/api/room.ts` | 197 | Room ID resolution with retry |
| `src/cli/commands/download.ts` | 119 | CLI download command handler |
| `src/cli/commands/watch.ts` | 143 | CLI watch command handler |
| `src/errors.ts` | 58 | Custom error classes including `AbortError` |
