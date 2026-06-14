# Stream Architecture Comparison: tokrec vs Michele0303/tiktok-live-recorder

> **Source**: [`Michele0303/tiktok-live-recorder`](https://github.com/Michele0303/tiktok-live-recorder) (v7.6.0, Python)
>
> **Date**: 2026-06-14

---

## Overview

Michele0303's codebase is a **Python** TikTok live recorder (v7.6.0). It's synchronous, uses `requests` for HTTP streaming, `ffmpeg-python` for FFmpeg post-processing, and `multiprocessing` for multi-user support. No async event loop, no AbortController, no typed event system.

tokrec is a **TypeScript/Bun** recorder (v0.7.1). It uses the Web Streams API for FLV download, direct `spawn()` for FFmpeg, an `AbortController`-based cancellation system, a typed event emitter, and explicit state machine.

---

## 1. Abort/Stop Handling

### Michele (Python)

**No signal handlers registered.** No `signal.signal()` or `signal.sigint` call exists anywhere. The only abort mechanism is `KeyboardInterrupt` exception handling:

- In `start_recording()` — catches `KeyboardInterrupt`, sets `stop_recording = True`
- In `run_recordings()` (multi-user) — catches `KeyboardInterrupt`, joins child processes, second Ctrl-C force-terminates

```python
# src/core/tiktok_recorder.py (simplified)
def start_recording(self, live_url):
    stop_recording = False
    with open(output, "wb") as out_file:
        while not stop_recording:
            try:
                for chunk in self.tiktok.download_live_stream(live_url):
                    buffer.extend(chunk)
                    # ...
            except KeyboardInterrupt:
                stop_recording = True
```

**Critical gaps:**
- `time.sleep(120)` (automatic mode interval) **blocks signal delivery** on some platforms — Ctrl-C may be ignored until sleep finishes
- Single-user mode has **no signal handling at all** — `KeyboardInterrupt` propagates to a generic `except Exception` in `main()`
- No SIGTERM handling — Docker `docker stop` sends SIGTERM, which immediately kills the process without flushing buffers
- Ctrl-C during FFmpeg conversion may leave an orphaned subprocess

### tokrec (TypeScript)

**Explicit signal handlers** with debounce:

```typescript
let stopping = false
const handleSignal = async () => {
  if (stopping) return
  stopping = true
  display.showInfo("Shutting down gracefully...")
  await recorder.stop()
  display.stop()
  process.exit(0)
}
process.on("SIGINT", handleSignal)
process.on("SIGTERM", handleSignal)
process.on("SIGHUP", handleSignal)
```

**Strengths:**
- Handles SIGINT, SIGTERM, and SIGHUP
- Debounced to handle simultaneous SIGINT+SIGTERM
- `recorder.stop()` is async and orchestrates full cleanup (abort download → stop monitor → close HTTP client)
- Async sleep with 1-second granularity means stop is responsive within 1 second

---

## 2. AbortController / Cancellation

### Michele (Python)

**Not used.** Python 3.11+ has `asyncio.CancelledError` but this is a synchronous codebase. The only cancellation mechanism is the `stop_recording` boolean flag, which cannot interrupt:
- Blocking `time.sleep()` calls
- `requests.iter_content()` blocking on a network read
- `ffmpeg-python` subprocess calls

```python
# The check happens only between chunk reads:
while not stop_recording:
    for chunk in stream.iter_content(chunk_size=4096):
        if stop_recording:  # checked every chunk, ~4KB
            break
        buffer.extend(chunk)
```

### tokrec (TypeScript)

**Full `AbortController` usage:**

```typescript
let abortController = new AbortController()

function abort(): void {
  abortController.abort()
  streamReader?.cancel().catch(() => {})
  if (ffmpegProcess && !ffmpegProcess.killed) {
    ffmpegProcess.kill("SIGTERM")
  }
}

// Single abort promise, races against every read:
const abortPromise = new Promise<never>((_, reject) => {
  abortController.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true })
})

while (!abortController.signal.aborted) {
  const result = await Promise.race([
    timeout(reader.read(), 60_000, "Stream read timed out"),
    abortPromise,
  ])
}
```

**Strengths:**
- `AbortSignal` is checked both synchronously (loop condition) and via promise racing
- Abort cancels the stream reader and kills FFmpeg
- 60-second read timeout prevents indefinite blocking
- Single listener with `{ once: true }` prevents memory leak

---

## 3. FFmpeg Subprocess Management

### Michele (Python)

FFmpeg is used **only for post-processing** (FLV→MP4 conversion), not during live stream download.

```python
# src/utils/video_management.py
import ffmpeg
ffmpeg.input(file).output(output_file, **output_args).run(quiet=True)
```

**Critical gaps:**
- `ffmpeg-python`'s `.run()` is a **blocking synchronous call** — cannot be cancelled or interrupted
- No FFmpeg process reference is stored — no way to `proc.kill()` if Ctrl-C arrives during conversion
- No startup timeout
- No `-reconnect` flags (FFmpeg is only used on the already-downloaded file)

### tokrec (TypeScript)

FFmpeg is used in three places:

| Use | File | Approach |
|---|---|---|
| HLS download | `stream.ts:267-354` | `spawn()` with M3U8 URL + `-c copy` |
| FLV→MP4 conversion | `convert.ts:69-102` | `spawn()` with `-c copy` |
| Segmenting | `recorder/index.ts:244-259` | `spawn()` with `-f segment` |

Key patterns:
```typescript
const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] })
ffmpegProcess = proc  // stored for external kill

// On abort:
if (ffmpegProcess && !ffmpegProcess.killed) {
  ffmpegProcess.kill("SIGTERM")
}

// Timers cleaned up in close/error handlers:
proc.on("close", (code) => {
  clearInterval(progressTimer)
  if (maxDurationTimer) clearTimeout(maxDurationTimer)
  ffmpegProcess = null
})
```

**Strengths:**
- Process reference stored for external kill via `SIGTERM`
- All timers cleaned up in `close`/`error` handlers
- `stderr` capped at 10KB to prevent memory leak
- 60-second read timeout on FLV path

---

## 4. Event System

### Michele (Python)

**None.** No pub/sub, no event emitter, no typed events. The only "event" mechanism is logging:

```python
logger.info("Started recording...")
logger.info("User is no longer live. Stopping recording.")
```

All coordination is via direct method calls and exception propagation.

### tokrec (TypeScript)

**Typed event emitter:**

```typescript
const eventHandlers = new Map<string, Array<(...args: any[]) => void>>()

function on<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void { ... }
function off<E extends RecorderEvent>(event: E, handler: RecorderEventHandler[E]): void { ... }
function emit<E extends RecorderEvent>(event: E, ...args: Parameters<RecorderEventHandler[E]>): void {
  const list = eventHandlers.get(event)
  if (list) {
    for (const h of list) {
      try { h(...args) } catch {}  // error isolation per handler
    }
  }
}
```

Events: `checking`, `tick`, `recording:start`, `download:progress`, `download:end`, `recording:end`, `segmenting:start`, `segmenting:end`, `converting:start`, `converted`, `normalize:start`, `normalize:progress`, `normalize:end`, `normalize:error`, `error`.

---

## 5. Timer/Interval Management

### Michele (Python)

Uses `time.sleep()` extensively:

```python
time.sleep(self.automatic_interval * 60)  # 2-120 minutes, blocking
time.sleep(TimeOut.CONNECTION_CLOSED * 60)  # 2 minutes, blocking
time.sleep(2)  # retry delay
time.sleep(2.5)  # follower recording spacing
time.sleep(0.5)  # file release wait loop
```

All are **blocking and uninterruptible** — Ctrl-C is not delivered until the sleep completes on some platforms.

### tokrec (TypeScript)

Uses async patterns:

```typescript
// Monitor polling — checks every 1 second, interruptible:
let waited = 0
while (waited < intervalMs) {
  if (!active) break
  await sleep(Math.min(checkInterval, intervalMs - waited))
  waited += checkInterval
}

// HLS progress — setInterval with cleanup:
const progressTimer = setInterval(() => { ... }, 1000)
proc.on("close", () => clearInterval(progressTimer))
proc.on("error", () => clearInterval(progressTimer))

// Max duration — setTimeout with cleanup:
let maxDurationTimer = setTimeout(() => { proc.kill("SIGTERM") }, maxDuration * 1000)
proc.on("close", () => { if (maxDurationTimer) clearTimeout(maxDurationTimer) })
```

---

## 6. Stream/Writer Patterns and Cleanup

### Michele (Python)

```python
# Stream download — NO cleanup of HTTP response:
def download_live_stream(self, live_url: str):
    stream = self._http_client_stream.get(live_url, stream=True)
    for chunk in stream.iter_content(chunk_size=4096):
        if chunk:
            yield chunk
    # stream is NEVER closed! HTTP connection leak.

# File writing — proper cleanup via context manager:
with open(output, "wb") as out_file:
    buffer = bytearray()
    while not stop_recording:
        try:
            for chunk in self.tiktok.download_live_stream(live_url):
                buffer.extend(chunk)
                if len(buffer) >= buffer_size:
                    out_file.write(buffer)
                    buffer.clear()
        except ...:
            ...
        finally:
            if buffer:
                out_file.write(buffer)
                buffer.clear()
            out_file.flush()
```

**Issues:**
- `requests` stream response object **never closed** — leaks HTTP connections
- No timeout on `iter_content()` — can block forever
- Generator is abandoned without cleanup if `stop_recording` becomes True mid-iteration

### tokrec (TypeScript)

```typescript
// Stream — properly cancelled on all exit paths:
const reader = response.body.getReader()
streamReader = reader

try {
  // ... read loop ...
  if (chunk.done) {
    reader.cancel().catch(() => {})  // cleanup on natural end
    break
  }
  if (e >= maxDuration) {
    reader.cancel().catch(() => {})  // cleanup on duration limit
    break
  }
} catch (err) {
  abort()  // calls reader.cancel() internally
} finally {
  streamReader = null
}

// File writer — always ended properly:
const writer = createWriteStream(filepath)
try {
  // ... write loop ...
} finally {
  if (buffer.length > 0) {
    await writeBuffer(writer, buffer)  // flush remaining
  }
  await new Promise<void>((resolve) => writer.end(resolve))
}
```

---

## 7. State Management

### Michele (Python)

**No explicit state machine.** Implicit state via:
- `stop_recording` boolean flag
- `self.mode` (MANUAL / AUTOMATIC / FOLLOWERS)
- `active_recordings` dict (follower → Thread in followers_mode)
- No `"idle"`, `"polling"`, `"recording"`, `"converting"`, `"stopped"` distinction

### tokrec (TypeScript)

**Explicit state machine:**

```typescript
interface RecorderStatus {
  state: "idle" | "polling" | "recording" | "converting" | "stopped"
  user: string
  currentFile?: string
  sessionDuration?: number
}
```

Transitions: `idle → polling → recording → converting → polling` (or `→ stopped` on stop).

---

## 8. Reconnection

### Michele (Python)

**Blind reconnection with no limit.** The outer `while not stop_recording` loop re-enters `download_live_stream()` every time the inner `for chunk in ...` generator finishes:

```python
while not stop_recording:
    for chunk in self.tiktok.download_live_stream(live_url):
        # ... process chunk ...
    # Stream ended — immediately re-enter the loop and reconnect
    # No check if user is still live
    # No limit on reconnection attempts
```

On network error:
```python
except ConnectionError:
    if self.mode == Mode.AUTOMATIC:
        time.sleep(120)
    # In MANUAL mode: SILENTLY SWALLOWED — no retry, no log, no break
```

### tokrec (TypeScript)

**Explicit reconnection with safety valve:**

```typescript
let reconnectCount = 0
const getNextUrl = async (): Promise<string | null> => {
  reconnectCount++
  if (reconnectCount > 100) {
    logger.warn(`Reconnection limit reached (${reconnectCount} attempts)`)
    return null  // safety valve
  }
  api!.invalidateCache()
  const stillLive = await api!.getRoomId(user)
  if (!stillLive) return null  // check user is still live
  return api!.getLiveUrl(stillLive)  // fresh URL
}
```

Old reader is cancelled before opening a new one. Reconnection respects abort signal and duration limit.

---

## 9. Error Handling

### Michele (Python)

```python
except ConnectionError:
    if self.mode == Mode.AUTOMATIC:
        logger.error("Connection closed...")
        time.sleep(120)
    # MANUAL mode: silently swallowed — no log, no retry, no notification

except (RequestException, HTTPException) as ex:
    logger.warning(f"Network hiccup, retrying: {ex}")
    time.sleep(2)

except KeyboardInterrupt:
    logger.info("Recording stopped by user.")
    stop_recording = True

except Exception as ex:
    logger.error(f"Unexpected error during recording: {ex}", exc_info=True)
    stop_recording = True
```

### tokrec (TypeScript)

```typescript
// Structured error types:
class TikTokError extends Error {
  constructor(
    public readonly kind: AppErrorKind,  // typed error category
    message: string,
    public readonly cause?: unknown,
  ) { super(message) }
}

// Typed error kinds:
type AppErrorKind =
  | "user-not-live" | "room-not-found" | "stream-url-not-found"
  | "waf-blocked" | "country-blocked" | "network-error"
  | "ffmpeg-not-found" | "config-error" | "unknown"

// Read timeout prevents indefinite blocking:
const result = await Promise.race([
  timeout(reader.read(), 60_000, "Stream read timed out"),
  abortPromise,
])
```

---

## 10. Memory Management

| Aspect | Michele | tokrec |
|---|---|---|
| **Stream buffer** | 512 KB `bytearray()` | 512 KB `Buffer` |
| **Buffer flush in error** | ✅ `finally` block | ✅ `catch` + `finally` |
| **FFmpeg stderr cap** | ❌ Not capped (delegated to `ffmpeg-python`) | ✅ 10KB cap, trimmed to last 5KB |
| **HTTP connection cleanup** | ❌ `requests` stream never closed | ✅ `reader.cancel()` on all exit paths |
| **Unbounded collections** | `active_recordings` dict; follower list | None in streaming path |
| **Event handlers** | N/A | Map with `off()` support |

---

## Summary Comparison

| Category | Michele (Python v7.6.0) | tokrec (TypeScript v0.7.1) |
|---|---|---|
| **Language** | Python 3.11+ | TypeScript / Bun |
| **HTTP client** | `requests` with `curl_cffi` | `wreq-js` (TLS fingerprinting) |
| **FFmpeg wrapper** | `ffmpeg-python` (no kill support) | Direct `spawn()` with `SIGTERM` kill |
| **Stream API** | `requests.iter_content()` (blocking) | Web Streams API (async) |
| **Read timeout** | ❌ None — can block forever | ✅ 60-second timeout |
| **Abort mechanism** | `stop_recording` boolean flag | `AbortController` + `Promise.race` |
| **Signal handlers** | ❌ None (relies on `KeyboardInterrupt`) | ✅ SIGINT/SIGTERM/SIGHUP with debounce |
| **Graceful shutdown** | ❌ No centralized `stop()` | ✅ `recorder.stop()` orchestrates full cleanup |
| **HTTP connection cleanup** | ❌ Never closed (leaked) | ✅ `reader.cancel()` on all paths |
| **FFmpeg interruptibility** | ❌ Cannot be cancelled | ✅ `proc.kill("SIGTERM")` on abort |
| **Reconnection** | Blind, unlimited, no still-live check | Limited to 100 attempts, checks still-live |
| **Event system** | None | Typed event emitter with `off()` |
| **State machine** | Implicit booleans | Explicit `idle/polling/recording/converting/stopped` |
| **Error types** | String messages | Structured `TikTokError` with `kind` field |
| **Timers** | Blocking `time.sleep()` | Async sleep + `setTimeout`/`setInterval` with cleanup |
| **Multi-user** | ✅ `multiprocessing` | ❌ Single-user only |
| **Telegram upload** | ✅ Via Telethon | ❌ |
| **Docker** | ✅ Multi-stage Dockerfile | ❌ |
| **Tests** | ❌ Zero tests | ✅ 62 tests with fixtures |
| **Buffer size** | 512 KB | 512 KB |

---

## Key Lessons for tokrec from Michele

1. **Multi-user support** — Michele's `multiprocessing` approach for recording multiple users simultaneously is a feature tokrec doesn't have.
2. **Telegram integration** — Post-recording notification/upload via Telethon.
3. **Docker image** — Multi-stage Dockerfile for easy deployment.
4. **Automatic update checking** — Checks GitHub for new releases.

## Key Lessons for Michele from tokrec

1. **Signal handlers** — Registering `signal.signal(SIGINT/SIGTERM)` with a graceful shutdown path would fix the most critical reliability gap.
2. **Read timeout** — `requests` accepts a `timeout` parameter; without it, a dropped connection blocks forever.
3. **HTTP response cleanup** — Using `with requests.get(...) as stream:` or calling `stream.close()` would fix the leaked connection.
4. **FFmpeg process reference** — Storing the `subprocess.Popen` reference would allow `proc.terminate()` on abort.
5. **Reconnection limit** — Adding a max retry counter and checking if the user is still live.
6. **Structured errors** — Typed error classes instead of string messages.
7. **Test coverage** — Even basic unit tests for the core recording loop.

---

## Source Files Examined

| File | Lines | Content |
|---|---|---|
| `src/core/tiktok_recorder.py` | ~340 | Main recorder: live detection, stream download, buffer management, error handling |
| `src/core/tiktok_api.py` | ~370 | TikTok API: room info, live URL, stream download generator |
| `src/main.py` | ~100 | Entry point: CLI parsing, multi-user orchestration |
| `src/utils/video_management.py` | ~60 | FFmpeg FLV→MP4 conversion |
| `src/http_utils/http_client.py` | ~80 | HTTP client with curl_cffi TLS impersonation |
| `src/utils/args_handler.py` | ~170 | CLI argument parsing |
| `src/utils/custom_exceptions.py` | ~30 | Custom exception classes |
| `src/utils/enums.py` | ~130 | Enums (Mode, TimeOut, Error messages) |
| `src/utils/logger_manager.py` | ~80 | Logging configuration |
| `src/utils/recorder_config.py` | ~15 | Recorder configuration |
| `src/utils/utils.py` | ~50 | Utility functions |
| `src/utils/dependencies.py` | ~130 | Dependency checking |
