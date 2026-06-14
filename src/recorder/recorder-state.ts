/**
 * State machine for the recorder lifecycle.
 */

import type { RecorderStatus } from "../config"
import type { Logger } from "../logger"

// Valid state transitions: [from] → [to, to, ...]
const TRANSITIONS: Record<string, string[]> = {
  idle: ["polling"],
  polling: ["recording", "stopped"],
  recording: ["converting", "stopped"],
  converting: ["polling", "stopped"],
  stopped: [],
}

export interface RecorderStateManager {
  setState(partial: Partial<RecorderStatus>): void
  getStatus(): RecorderStatus
}

export function createRecorderState(initial: RecorderStatus, logger: Logger): RecorderStateManager {
  let state: RecorderStatus = { ...initial }

  function setState(partial: Partial<RecorderStatus>): void {
    const prevState = state.state
    const newState = partial.state

    // Validate state transitions
    if (newState && newState !== prevState) {
      const allowed = TRANSITIONS[prevState]
      if (!allowed?.includes(newState)) {
        logger.error(`Invalid state transition: ${prevState} → ${newState} (ignored)`)
        return
      }
      logger.info(`State: ${prevState} → ${newState}`)
    }

    state = { ...state, ...partial }

    // Auto-track timestamps on state entry
    if (newState === "polling" && newState !== prevState) {
      state.lastPollTime = new Date().toISOString()
    }
  }

  function getStatus(): RecorderStatus {
    return { ...state }
  }

  return { setState, getStatus }
}
