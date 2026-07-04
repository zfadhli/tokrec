/**
 * tmux session helpers — per-user start/stop/status for background recording.
 *
 * Session naming: "tokrec-{user}" — each user gets an independent tmux session.
 */

import { execa } from "execa"

function sessionName(user: string): string {
  return `tokrec-${user}`
}

async function hasSession(name: string): Promise<boolean> {
  const { exitCode } = await execa("tmux", ["has-session", "-t", name], { reject: false })
  return exitCode === 0
}

export async function tmuxStart(user: string, command: string): Promise<void> {
  const name = sessionName(user)
  if (await hasSession(name)) {
    throw new Error(`Session "${name}" already exists. Run "tokrec stop -u ${user}" first.`)
  }

  await execa("tmux", ["new-session", "-d", "-s", name, command])
}

export async function tmuxStop(user?: string): Promise<void> {
  if (user) {
    const name = sessionName(user)
    if (!(await hasSession(name))) {
      throw new Error(`No session "${name}" found.`)
    }
    await execa("tmux", ["kill-session", "-t", name])
    return
  }

  // Stop all tokrec-* sessions
  const { stdout } = await execa("tmux", ["list-sessions", "-F", "#{session_name}"], {
    reject: false,
  })
  const sessions = stdout.split("\n").filter((s) => s.startsWith("tokrec-"))

  if (sessions.length === 0) {
    throw new Error("No active tokrec sessions found.")
  }

  for (const s of sessions) {
    await execa("tmux", ["kill-session", "-t", s])
  }
}

export interface SessionInfo {
  user: string
  session: string
}

export async function tmuxStatus(user?: string): Promise<SessionInfo[]> {
  const { stdout } = await execa("tmux", ["list-sessions", "-F", "#{session_name}"], {
    reject: false,
  })

  const all = stdout
    .split("\n")
    .filter((s) => s.startsWith("tokrec-"))
    .map((s) => ({ user: s.slice("tokrec-".length), session: s }))

  if (user) {
    return all.filter((s) => s.user === user)
  }

  return all
}
