/**
 * Terminal Display Manager — console output via yocto-spinner and yoctocolors.
 *
 * This module owns the terminal and should be the only thing writing to
 * stdout/stderr (the file logger handles persistent logs).
 */

import {
  bytesToHuman,
  formatDuration,
  isLiveReason,
  type RecorderController,
  relativeTime,
} from "@zfadhli/tokrec"
import yoctoSpinner, { type Spinner } from "yocto-spinner"
import * as color from "yoctocolors"

// ─── Tag helpers ──────────────────────────────────────────
const tag = {
  ok: color.bold(color.green("[OK] ")),
  done: color.bold(color.green("[DONE] ")),
  live: color.bold(color.green("[LIVE] ")),
  info: color.bold(color.blue("[INFO] ")),
  off: color.bold(color.blue("[OFF] ")),
  lock: color.bold(color.yellow("[LOCK] ")),
  warn: color.bold(color.yellow("[WARN] ")),
  err: color.bold(color.red("[ERR] ")),
}

export interface Display {
  /** Called once when polling begins. */
  pollingStarted(intervalMinutes: number): void
  /** Spinner while checking if a user is live. */
  checkingUser(user: string): void
  /** User is offline (no active display). */
  userOffline(user: string): void
  /** User is still offline — updates the previous offline line with a timestamp. */
  userOfflineRepeat(user: string, lastCheck: string): void
  /** User is live! Clears the checking spinner. */
  userLive(user: string, roomId: string): void
  /** User is live but age-protected/restricted — stream unavailable. */
  userRestricted(user: string): void
  /** User is live but no stream URL was resolved. */
  userLiveNoStream(user: string, roomId: string): void

  /** Recording starts: spinner without filename (known only post-download). */
  startRecording(): void
  /** Recording finished successfully. Shows filename from the result. */
  finishRecording(filename: string, duration: number, size: string): void
  /** Recording encountered a non-fatal error. */
  recordingError(message: string): void

  /** FFmpeg segmenting starts. */
  startSegmenting(): void
  /** FFmpeg segmenting done. */
  segmentsCreated(count: number): void

  /** FFmpeg simple conversion starts (fallback path). */
  startConverting(): void
  /** Simple conversion done. */
  conversionDone(output: string): void

  /** Audio normalization starts (EBU R128 via peaknorm). */
  normalizeStart(): void
  /** Audio normalization progress update. */
  normalizeProgress(percent: number, phase: string): void
  /** Audio normalization completed successfully. */
  normalizeComplete(): void
  /** Audio normalization failed. */
  normalizeError(message: string): void

  /** Show version banner at startup. */
  showVersion(name: string, version: string): void

  /** General-purpose status helpers. */
  showError(message: string): void
  showInfo(message: string): void
  showWarning(message: string): void

  /** Stop all active spinners and clean up the terminal. */
  stop(): void
}

export function createDisplay(): Display {
  // yocto-spinner with handleSignals off: bin.ts owns SIGINT/SIGTERM teardown.
  const stream = process.stdout
  // Mirrors yocto-spinner's internal isInteractive(); spinner.text writes a full
  // line when non-interactive, so per-tick updates must be skipped there.
  const animated = Boolean(stream.isTTY && process.env.TERM !== "dumb" && !("CI" in process.env))
  const spin = (text: string): Spinner => yoctoSpinner({ text, stream, handleSignals: false })

  let activeSpinner: Spinner | null = null
  let offlineLineShown = false

  // Recording timer state
  let recordingStartTime: number | null = null
  let recordingTimer: ReturnType<typeof setInterval> | null = null

  /** Stop the currently active spinner (if any) without printing anything. */
  function clearSpinner(): void {
    if (recordingTimer) {
      clearInterval(recordingTimer)
      recordingTimer = null
    }
    if (activeSpinner?.isSpinning) {
      activeSpinner.stop()
    }
    activeSpinner = null
  }

  /** Stop the current spinner and print a one-liner with the given tag prefix. */
  function finalize(prefix: string, text: string): void {
    clearSpinner()
    process.stdout.write(`${prefix}${text}\n`)
  }

  return {
    pollingStarted(intervalMinutes: number): void {
      finalize(
        tag.info,
        `${color.dim("Polling started (every ")}${color.bold(color.yellow(String(intervalMinutes)))}${color.dim(" min)")}`,
      )
    },

    checkingUser(user: string): void {
      clearSpinner()
      activeSpinner = spin(color.cyan(`Checking @${user}...`))
      activeSpinner.start()
    },

    userOffline(user: string): void {
      finalize(tag.off, `${color.bold(color.yellow(`@${user}`))}${color.dim(" is offline")}`)
      offlineLineShown = true
    },

    userOfflineRepeat(user: string, lastCheck: string): void {
      clearSpinner()
      const text = `${tag.off}${color.bold(color.yellow(`@${user}`))}${color.dim(" is offline")} ${color.dim(`[last online: ${color.bold(color.yellow(lastCheck))}]`)}`
      if (offlineLineShown) {
        // Move cursor up one line and overwrite the previous offline message
        process.stdout.write(`\x1b[1A\r${text}\x1b[K\n`)
      } else {
        process.stdout.write(`${text}\n`)
        offlineLineShown = true
      }
    },

    userLive(user: string, roomId: string): void {
      clearSpinner()
      offlineLineShown = false
      process.stdout.write(
        `${tag.live}${color.bold(color.green(`@${user}`))} ${color.dim(`(room: ${color.bold(color.yellow(roomId))})`)}\n`,
      )
    },

    userRestricted(user: string): void {
      clearSpinner()
      offlineLineShown = false
      process.stdout.write(
        `${tag.lock}${color.bold(color.yellow(`@${user}`))}${color.dim(" is live but age-protected/restricted \u2014 stream unavailable to this session")}\n`,
      )
    },

    userLiveNoStream(user: string, roomId: string): void {
      clearSpinner()
      offlineLineShown = false
      process.stdout.write(
        `${tag.live}${color.bold(color.green(`@${user}`))} ${color.dim(`(room: ${color.bold(color.yellow(roomId))}) \u2014 no stream URL found`)}\n`,
      )
    },

    startRecording(): void {
      clearSpinner()
      recordingStartTime = Date.now()
      activeSpinner = spin(
        `${color.cyan("Recording...")} ${color.dim(`[${color.bold(color.yellow("0s"))}]`)}`,
      )
      activeSpinner.start()

      recordingTimer = setInterval(() => {
        if (!animated || !activeSpinner?.isSpinning || !recordingStartTime) return
        const elapsed = (Date.now() - recordingStartTime) / 1000
        activeSpinner.text = `${color.cyan("Recording...")} ${color.dim(`[${color.bold(color.yellow(formatDuration(elapsed)))}]`)}`
      }, 1000)
    },

    finishRecording(filename: string, duration: number, size: string): void {
      finalize(
        tag.done,
        `${color.cyan(filename)}${color.dim(" — ")}${color.bold(color.yellow(size))}${color.dim(` in ${color.bold(color.yellow(formatDuration(duration)))}`)}`,
      )
    },

    recordingError(message: string): void {
      finalize(tag.err, color.red(`Recording failed: ${message}`))
    },

    startSegmenting(): void {
      clearSpinner()
      activeSpinner = spin(color.cyan("Segmenting..."))
      activeSpinner.start()
    },

    segmentsCreated(count: number): void {
      finalize(
        tag.ok,
        `${color.dim("Created ")}${color.bold(color.yellow(String(count)))}${color.dim(` MP4 segment${count !== 1 ? "s" : ""}`)}`,
      )
    },

    startConverting(): void {
      clearSpinner()
      activeSpinner = spin(color.cyan("Converting to MP4..."))
      activeSpinner.start()
    },

    conversionDone(output: string): void {
      finalize(tag.done, `${color.cyan(output)}`)
    },

    normalizeStart(): void {
      clearSpinner()
      activeSpinner = spin(color.cyan("Normalizing audio..."))
      activeSpinner.start()
    },

    normalizeProgress(percent: number, phase: string): void {
      if (!animated || !activeSpinner?.isSpinning) return
      const label = phase === "analyzing" ? "Analyzing" : "Normalizing"
      activeSpinner.text = ` ${label}... ${color.bold(color.yellow(`${percent}%`))}`
    },

    normalizeComplete(): void {
      finalize(tag.ok, color.green("Audio normalized"))
    },

    normalizeError(message: string): void {
      finalize(tag.err, color.red(`Normalization failed: ${message}`))
    },

    showVersion(name: string, version: string): void {
      clearSpinner()
      offlineLineShown = false
      process.stdout.write(`${color.dim(`${name} ${version}`)}\n`)
    },

    showError(message: string): void {
      clearSpinner()
      offlineLineShown = false
      process.stdout.write(`${tag.err}${color.red(message)}\n`)
    },

    showInfo(message: string): void {
      clearSpinner()
      offlineLineShown = false
      process.stdout.write(`${tag.info}${color.dim(message)}\n`)
    },

    showWarning(message: string): void {
      clearSpinner()
      offlineLineShown = false
      process.stdout.write(`${tag.warn}${color.yellow(message)}\n`)
    },

    stop(): void {
      clearSpinner()
      offlineLineShown = false
    },
  }
}

/**
 * Wire the recorder's four event channels to the terminal.
 *
 * Lives next to the display it drives: the mapping from recorder phase to
 * terminal line is presentation, so `bin.ts` should not carry it.
 */
export function attachDisplay(
  display: Display,
  recorder: Pick<RecorderController, "on">,
  user: string,
): void {
  let lastWasLive: boolean | null = null
  let firstOfflineTime = 0

  recorder.on("verdict", (verdict) => {
    if (verdict.reason === "restricted") {
      display.userRestricted(user)
    } else if (verdict.reason === "no-stream-url") {
      display.userLiveNoStream(user, verdict.room?.id ?? "?")
    } else if (isLiveReason(verdict.reason)) {
      display.userLive(user, verdict.room?.id ?? "?")
    } else if (lastWasLive === null || lastWasLive === true) {
      display.userOffline(user)
      firstOfflineTime = Date.now()
    } else {
      display.userOfflineRepeat(user, relativeTime(Date.now() - firstOfflineTime))
    }
    lastWasLive = isLiveReason(verdict.reason)
  })

  recorder.on("record", (event) => {
    switch (event.phase) {
      case "start":
        display.startRecording()
        break
      case "download": {
        const parsed = event.file.split("/").pop() ?? event.file
        display.finishRecording(parsed, event.duration, bytesToHuman(event.size))
        break
      }
      case "segment":
        if (event.status === "start") display.startSegmenting()
        else display.segmentsCreated(event.segments)
        break
      case "convert":
        if (event.status === "start") display.startConverting()
        else display.conversionDone(event.output.split("/").pop() ?? event.output)
        break
      case "normalize":
        if (event.status === "start") display.normalizeStart()
        else if (event.status === "done") display.normalizeComplete()
        else display.normalizeError(event.error)
        break
      case "end":
        break
    }
  })

  recorder.on("progress", (event) => {
    if (event.kind === "normalize") display.normalizeProgress(event.percent, event.phase)
  })

  recorder.on("failure", (err) => {
    display.showError(`[${err.code}] ${err.message}`)
  })
}
