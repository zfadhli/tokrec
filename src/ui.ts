/**
 * Terminal Display Manager — beautiful console output using koko-cli's
 * spinner, icons, and color utilities.
 *
 * This module owns the terminal and should be the only thing writing to
 * stdout/stderr (the file logger handles persistent logs).
 */

import {
  ICON_ERROR,
  ICON_INFO,
  ICON_SUCCESS,
  ICON_WARN,
  color,
  createSpinner,
} from "@zfadhli/koko-cli";
import type { SpinnerInstance } from "@zfadhli/koko-cli";

export interface Display {
  /** Called once when polling begins. */
  pollingStarted(intervalMinutes: number): void;
  /** Spinner while checking if a user is live. */
  checkingUser(user: string): void;
  /** User is offline (no active display). */
  userOffline(user: string): void;
  /** User is live! Clears the checking spinner. */
  userLive(user: string, roomId: string): void;

  /** Recording starts: spinner without filename (known only post-download). */
  startRecording(): void;
  /** Update the recording spinner with live counters. */
  updateProgress(bytes: number, elapsed: number, speed: number): void;
  /** Recording finished successfully. Shows filename from the result. */
  finishRecording(filename: string, duration: number, size: string): void;
  /** Recording encountered a non-fatal error. */
  recordingError(message: string): void;

  /** FFmpeg segmenting starts. */
  startSegmenting(): void;
  /** FFmpeg segmenting done. */
  segmentsCreated(count: number): void;

  /** FFmpeg simple conversion starts (fallback path). */
  startConverting(): void;
  /** Simple conversion done. */
  conversionDone(output: string): void;

  /** General-purpose status helpers. */
  showError(message: string): void;
  showInfo(message: string): void;
  showWarning(message: string): void;

  /** Stop all active spinners and clean up the terminal. */
  stop(): void;
}

export function createDisplay(): Display {
  let activeSpinner: SpinnerInstance | null = null;

  /** Stop the currently active spinner (if any) without printing anything. */
  function clearSpinner(): void {
    if (activeSpinner?.isSpinning) {
      activeSpinner.stop();
    }
    activeSpinner = null;
  }

  /** Stop the current spinner and print a one-liner with the given icon. */
  function finalize(icon: string, text: string): void {
    clearSpinner();
    process.stdout.write(`  ${icon} ${text}\n`);
  }

  /** Format seconds into a compact human-readable duration. */
  function fmtDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  /** Format bytes into human-readable size. */
  function fmtBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1,
    );
    return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
  }

  /** Format bytes per second into a readable speed string. */
  function fmtSpeed(bytesPerSec: number): string {
    if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
    if (bytesPerSec < 1024 * 1024)
      return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }

  return {
    pollingStarted(intervalMinutes: number): void {
      finalize(
        ICON_SUCCESS,
        color.dim(`Polling started (every ${intervalMinutes} min)`),
      );
    },

    checkingUser(user: string): void {
      clearSpinner();
      activeSpinner = createSpinner(color.cyan(`Checking @${user}...`));
      activeSpinner.start();
    },

    userOffline(user: string): void {
      finalize(ICON_INFO, color.dim(`@${user} is offline`));
    },

    userLive(user: string, roomId: string): void {
      clearSpinner();
      process.stdout.write(
        `  ${ICON_SUCCESS} ${color.green(`@${user} is LIVE!`)} ${color.dim(`(room: ${roomId})`)}\n`,
      );
    },

    startRecording(): void {
      clearSpinner();
      activeSpinner = createSpinner(color.cyan("Recording stream..."));
      activeSpinner.start();
    },

    updateProgress(bytes: number, elapsed: number, speed: number): void {
      if (!activeSpinner || !activeSpinner.isSpinning) return;
      activeSpinner.text = ` ${fmtBytes(bytes)} ${color.dim("•")} ${fmtDuration(elapsed)} ${color.dim("•")} ${fmtSpeed(speed)}`;
    },

    finishRecording(filename: string, duration: number, size: string): void {
      finalize(
        ICON_SUCCESS,
        `${color.green("Recording finished")} ${color.dim(`${filename} — ${size} in ${fmtDuration(duration)}`)}`,
      );
    },

    recordingError(message: string): void {
      finalize(ICON_ERROR, color.red(`Recording failed: ${message}`));
    },

    startSegmenting(): void {
      clearSpinner();
      activeSpinner = createSpinner(color.cyan("Segmenting..."));
      activeSpinner.start();
    },

    segmentsCreated(count: number): void {
      finalize(
        ICON_SUCCESS,
        color.green(`Created ${count} MP4 segment${count !== 1 ? "s" : ""}`),
      );
    },

    startConverting(): void {
      clearSpinner();
      activeSpinner = createSpinner(color.cyan("Converting to MP4..."));
      activeSpinner.start();
    },

    conversionDone(output: string): void {
      finalize(ICON_SUCCESS, color.green(`Converted: ${output}`));
    },

    showError(message: string): void {
      clearSpinner();
      process.stdout.write(`  ${ICON_ERROR} ${color.red(message)}\n`);
    },

    showInfo(message: string): void {
      clearSpinner();
      process.stdout.write(`  ${ICON_INFO} ${color.dim(message)}\n`);
    },

    showWarning(message: string): void {
      clearSpinner();
      process.stdout.write(`  ${ICON_WARN} ${color.yellow(message)}\n`);
    },

    stop(): void {
      clearSpinner();
    },
  };
}
