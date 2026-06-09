/**
 * Logger — rotating file + console with levels.
 * Zero-dependency minimal implementation (~60 lines).
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";

export interface Logger {
  debug: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

export function createLogger(opts: {
  level?: LogLevel;
  logFile?: string;
  maxSize?: number;
  backups?: number;
  /** When true (default), writes to stdout/stderr. Set false for file-only logging. */
  console?: boolean;
}): Logger {
  const level = opts.level ?? "info";
  const logFile = opts.logFile ?? "tiktok-recorder.log";
  const maxSize = opts.maxSize ?? 5 * 1024 * 1024; // 5 MB
  const backups = opts.backups ?? 3;
  const showConsole = opts.console !== false; // default true

  // Ensure parent directory exists
  const logDir = dirname(logFile);
  if (logDir !== ".") {
    mkdirSync(logDir, { recursive: true });
  }

  function rotateIfNeeded(): void {
    try {
      if (existsSync(logFile)) {
        const size = statSync(logFile).size;
        if (size >= maxSize) {
          // Remove the oldest backup
          const lastBackup = `${logFile}.${backups}`;
          if (existsSync(lastBackup)) {
            try {
              renameSync(lastBackup, `${lastBackup}.old`);
            } catch {
              // Best-effort cleanup
            }
          }
          // Shift backups
          for (let i = backups - 1; i >= 1; i--) {
            const src = `${logFile}.${i}`;
            const dst = `${logFile}.${i + 1}`;
            if (existsSync(src)) {
              try {
                renameSync(src, dst);
              } catch {
                // Best-effort
              }
            }
          }
          // Rename current → .1
          try {
            renameSync(logFile, `${logFile}.1`);
          } catch {
            // Best-effort
          }
        }
      }
    } catch {
      // Silent — never throw in logger
    }
  }

  // Touch the file
  try {
    if (!existsSync(logFile)) {
      writeFileSync(logFile, "", "utf-8");
    }
  } catch {
    // Best-effort
  }

  function write(level: LogLevel, msg: string, args: unknown[]): void {
    const ts = new Date().toISOString();
    const suffix =
      args.length > 0 ? ` ${args.map((a) => String(a)).join(" ")}` : "";
    const line = `[${ts}] [${level.toUpperCase()}] ${msg}${suffix}`;
    const formatted = `[${ts}] [${level.toUpperCase()}] ${msg}${suffix}`;

    // Console (optional — can be suppressed for file-only logging)
    if (showConsole) {
      if (level === "error") {
        process.stderr.write(`${LEVEL_COLORS[level]}${formatted}${RESET}\n`);
      } else {
        process.stdout.write(`${LEVEL_COLORS[level]}${formatted}${RESET}\n`);
      }
    }

    // File
    try {
      rotateIfNeeded();
      appendFileSync(logFile, `${line}\n`, "utf-8");
    } catch {
      // Best-effort
    }
  }

  return {
    debug: (msg, ...args) => {
      if (LEVEL_ORDER.debug >= LEVEL_ORDER[level]) write("debug", msg, args);
    },
    info: (msg, ...args) => {
      if (LEVEL_ORDER.info >= LEVEL_ORDER[level]) write("info", msg, args);
    },
    warn: (msg, ...args) => {
      if (LEVEL_ORDER.warn >= LEVEL_ORDER[level]) write("warn", msg, args);
    },
    error: (msg, ...args) => {
      if (LEVEL_ORDER.error >= LEVEL_ORDER[level]) write("error", msg, args);
    },
  };
}
