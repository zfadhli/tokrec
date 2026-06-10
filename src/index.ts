#!/usr/bin/env bun
/**
 * Entry point — parses CLI args, creates the recorder, and handles signals.
 * Uses the terminal Display manager for beautiful console output.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { color } from "@zfadhli/koko-cli"
import { extractTikTokCookiesFromFirefox } from "./browser-cookies"
import { parseArgs } from "./cli"
import type { RecorderConfig } from "./config"
import { TikTokError, validateConfig } from "./config"
import { createRecorder } from "./lib"
import { createDisplay } from "./ui"
import { bytesToHuman, relativeTime } from "./utils"

async function loadCookies(
  cookiesPath?: string,
): Promise<{ sessionid_ss: string; "tt-target-idc"?: string } | undefined> {
  const path = cookiesPath ?? join(process.cwd(), "cookies.json")
  if (!existsSync(path)) {
    return undefined
  }
  try {
    const content = readFileSync(path, "utf-8")
    const data = JSON.parse(content) as {
      sessionid_ss?: string
      "tt-target-idc"?: string
    }
    if (data.sessionid_ss && data.sessionid_ss.length > 0) {
      return data as { sessionid_ss: string; "tt-target-idc"?: string }
    }
    return undefined
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  let config: RecorderConfig

  try {
    config = parseArgs()
    validateConfig(config)
  } catch (err) {
    if (err instanceof TikTokError && err.kind === "config-error") {
      console.error(`${color.red("Error:")} ${err.message}`)
      process.exit(1)
    }
    throw err
  }

  // Load cookies: try Firefox browser first, then fall back to cookies.json
  config.cookies = extractTikTokCookiesFromFirefox() ?? (await loadCookies(config.cookiesPath))

  // Suppress internal logger's console output — the Display owns the terminal
  config.logConsole = false

  // Beautiful terminal display
  const display = createDisplay()

  if (!config.cookies) {
    display.showWarning(
      "No TikTok cookies found — log in at tiktok.com in Firefox or create cookies.json",
    )
  }

  const recorder = createRecorder(config)

  let lastWasLive: boolean | null = null
  let firstOfflineTime = 0

  // Subscribe to events for beautiful console output
  recorder.on("checking", (info) => {
    display.checkingUser(info.user)
  })

  recorder.on("tick", (info) => {
    if (info.isLive) {
      display.userLive(info.user, info.roomId ?? "?")
    } else if (lastWasLive === null || lastWasLive === true) {
      display.userOffline(info.user)
      firstOfflineTime = Date.now()
    } else {
      const elapsed = Date.now() - firstOfflineTime
      display.userOfflineRepeat(info.user, relativeTime(elapsed))
    }
    lastWasLive = info.isLive
  })

  recorder.on("recording:start", () => {
    display.startRecording()
  })

  recorder.on("download:progress", (info) => {
    display.updateProgress(info.bytes, info.elapsed, info.speed)
  })

  recorder.on("download:end", (info) => {
    const parsed = info.file.split("/").pop() ?? info.file
    const sizeStr = bytesToHuman(info.size)
    display.finishRecording(parsed, info.duration, sizeStr)
  })

  recorder.on("segmenting:start", () => {
    display.startSegmenting()
  })

  recorder.on("segmenting:end", (info) => {
    display.segmentsCreated(info.segments)
  })

  recorder.on("converting:start", () => {
    display.startConverting()
  })

  recorder.on("converted", () => {
    // Individual conversion results acknowledged via segmenting:end or recording:end
  })

  recorder.on("recording:end", () => {
    // For simple conversion (no segmenting), recording:end fires once.
    // For segmenting path, segmenting:end already acknowledges the result.
    // This is a no-op since we handle the terminal output through download:end
    // and segmenting:end / converted events.
  })

  recorder.on("error", (err) => {
    display.showError(`[${err.kind}] ${err.message}`)
  })

  recorder.on("normalize:start", () => {
    display.normalizeStart()
  })

  recorder.on("normalize:progress", (info) => {
    display.normalizeProgress(info.percent, info.phase)
  })

  recorder.on("normalize:end", () => {
    display.normalizeComplete()
  })

  recorder.on("normalize:error", (info) => {
    display.normalizeError(info.error)
  })

  // Signal handling
  let stopping = false
  const handleSignal = async () => {
    if (stopping) return  // ignore duplicate signals (e.g. SIGINT + SIGTERM from one Ctrl-C)
    stopping = true
    display.showInfo("Shutting down gracefully...")
    await recorder.stop()
    display.stop()
    process.exit(0)
  }

  process.on("SIGINT", handleSignal)
  process.on("SIGTERM", handleSignal)
  process.on("SIGHUP", handleSignal)

  // Show initial status and start the recorder
  display.pollingStarted(config.interval ?? 3)
  try {
    await recorder.start()
  } catch (err) {
    if (err instanceof TikTokError) {
      display.showError(`[${err.kind}] ${err.message}`)
    } else {
      display.showError(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    }
    await recorder.stop()
    display.stop()
    process.exit(1)
  }
}

main()
