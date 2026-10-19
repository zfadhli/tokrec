#!/usr/bin/env bun
/**
 * Entry point — parses CLI args, creates the recorder, and handles signals.
 * Uses the terminal Display manager for beautiful console output.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { RecorderConfig } from "@zfadhli/tokrec"
import {
  bytesToHuman,
  createRecorder,
  isLiveReason,
  relativeTime,
  TikTokError,
} from "@zfadhli/tokrec"
import * as color from "yoctocolors"
import { extractTikTokCookiesFromFirefox } from "./browser-cookies"
import { type CLIResult, parseArgs } from "./cli"
import { tmuxStart, tmuxStatus, tmuxStop } from "./tmux"
import { createDisplay } from "./ui"

async function loadCookies(cookiesPath?: string): Promise<Record<string, string> | undefined> {
  const path = cookiesPath ?? join(process.cwd(), "cookies.json")
  if (!existsSync(path)) {
    return undefined
  }
  try {
    const content = readFileSync(path, "utf-8")
    const data = JSON.parse(content) as Record<string, string | undefined>
    if (data.sessionid_ss && data.sessionid_ss.length > 0) {
      return data as Record<string, string>
    }
    return undefined
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  let result: CLIResult

  try {
    result = parseArgs()
  } catch (err) {
    if (err instanceof TikTokError && err.code === "config-error") {
      console.error(`${color.red("Error:")} ${err.message}`)
      process.exit(1)
    }
    throw err
  }

  // Handle tmux subcommands
  if (result.command === "start") {
    // Extract user from args to build session name
    const userMatch = result.args.find((_, i, a) => a[i - 1] === "--user" || a[i - 1] === "-u")
    if (!userMatch) {
      console.error(`${color.red("Error:")} --user is required for "start" command`)
      process.exit(1)
    }
    const cmd = `tokrec ${result.args.join(" ")}`
    try {
      await tmuxStart(userMatch, cmd)
      console.log(`${color.green("✓")} Session "tokrec-${userMatch}" started in background`)
      console.log(`  tmux attach -t tokrec-${userMatch}   — view live output`)
      console.log(`  tokrec stop -u ${userMatch}             — stop recording`)
    } catch (err) {
      console.error(`${color.red("Error:")} ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    return
  }

  if (result.command === "stop") {
    try {
      await tmuxStop(result.user)
      if (result.user) {
        console.log(`${color.green("✓")} Session "tokrec-${result.user}" stopped`)
      } else {
        console.log(`${color.green("✓")} All tokrec sessions stopped`)
      }
    } catch (err) {
      console.error(`${color.red("Error:")} ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    return
  }

  if (result.command === "status") {
    const sessions = await tmuxStatus(result.user)
    if (sessions.length === 0) {
      console.log(
        `${color.gray("○")} No active session${result.user ? ` for "${result.user}"` : ""}`,
      )
    } else {
      for (const s of sessions) {
        console.log(`${color.green("●")} tokrec-${s.user}`)
        console.log(`  tmux attach -t ${s.session}   — view live output`)
      }
    }
    return
  }

  if (result.command === "setup") {
    // 1. Check Firefox cookies
    const firefoxCookies = extractTikTokCookiesFromFirefox()
    if (firefoxCookies) {
      const names = Object.keys(firefoxCookies)
      const detail = names.length > 1 ? ` (${names.length} cookies)` : ""
      console.log(`${color.green("✓")} Firefox cookies detected${detail}`)
      console.log(`  No setup needed — tokrec auto-detects Firefox cookies.`)
      return
    }

    // 2. Check cookies.json
    const cookiesPath = join(process.cwd(), "cookies.json")
    if (existsSync(cookiesPath)) {
      try {
        const data = JSON.parse(readFileSync(cookiesPath, "utf-8"))
        if (data.sessionid_ss) {
          console.log(`${color.green("✓")} cookies.json found at ./cookies.json`)
          return
        }
      } catch {
        // invalid JSON, fall through to setup
      }
    }

    // 3. No cookies found — interactive setup
    console.log(`${color.yellow("⚠")} No TikTok cookies found.`)
    console.log()
    console.log(`You need a valid sessionid_ss cookie to bypass TikTok's WAF.`)
    console.log(`Either log in to TikTok in Firefox (auto-detected), or enter manually:`)
    console.log()

    const sessionid = prompt("  sessionid_ss cookie value:")
    if (!sessionid || sessionid.trim().length === 0) {
      console.log(`${color.red("✗")} No cookie provided. Setup cancelled.`)
      return
    }

    const cookies: Record<string, string> = { sessionid_ss: sessionid.trim() }

    const idc = prompt("  tt-target-idc (optional, press Enter to skip):")
    if (idc && idc.trim().length > 0) {
      cookies["tt-target-idc"] = idc.trim()
    }

    writeFileSync(cookiesPath, `${JSON.stringify(cookies, null, 2)}\n`)
    console.log()
    console.log(`${color.green("✓")} cookies.json created at ./cookies.json`)
    console.log(`  You can now run: tokrec -u <username>`)
    return
  }

  // Record command — full recorder flow
  const config: RecorderConfig = result.config

  // Load cookies: try Firefox browser first, then fall back to cookies.json
  const firefoxCookies = extractTikTokCookiesFromFirefox()
  config.cookies = firefoxCookies ?? (await loadCookies(config.cookiesPath))

  // Suppress internal logger's console output — the Display owns the terminal
  config.logConsole = false

  // Beautiful terminal display
  const display = createDisplay()

  if (config.cookies) {
    const source = firefoxCookies ? "Firefox" : "cookies.json"
    const names = Object.keys(config.cookies)
    const detail = names.length > 1 ? ` (${names.length} cookies)` : ""
    display.showInfo(`${source} cookies loaded${detail}`)
  } else {
    display.showWarning(
      "No TikTok cookies found — log in at tiktok.com in Firefox or create cookies.json",
    )
  }

  const recorder = createRecorder(config)

  let lastWasLive: boolean | null = null
  let firstOfflineTime = 0

  // Subscribe to the four-channel event contract
  recorder.on("verdict", (verdict) => {
    if (verdict.reason === "restricted") {
      display.userRestricted(config.user)
    } else if (verdict.reason === "no-stream-url") {
      display.userLiveNoStream(config.user, verdict.room?.id ?? "?")
    } else if (isLiveReason(verdict.reason)) {
      display.userLive(config.user, verdict.room?.id ?? "?")
    } else if (lastWasLive === null || lastWasLive === true) {
      display.userOffline(config.user)
      firstOfflineTime = Date.now()
    } else {
      const elapsed = Date.now() - firstOfflineTime
      display.userOfflineRepeat(config.user, relativeTime(elapsed))
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

  // Signal handling
  let stopping = false
  const handleSignal = async () => {
    if (stopping) return // ignore duplicate signals (e.g. SIGINT + SIGTERM from one Ctrl-C)
    stopping = true
    // Remove signal handlers so they don't accumulate if main() is called again
    process.off("SIGINT", handleSignal)
    process.off("SIGTERM", handleSignal)
    process.off("SIGHUP", handleSignal)
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
      display.showError(`[${err.code}] ${err.message}`)
    } else {
      display.showError(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    }
    process.off("SIGINT", handleSignal)
    process.off("SIGTERM", handleSignal)
    process.off("SIGHUP", handleSignal)
    await recorder.stop()
    display.stop()
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
