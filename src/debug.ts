/**
 * Centralized debug logger for the SDK.
 *
 * Off by default — consumers opt in:
 * ```ts
 * import { debug } from "@lglen/bing-image-search";
 * debug.enable();
 * // or: debug.setLevel("debug");
 * ```
 *
 * For custom logging (e.g. Firebase / structured logging):
 * ```ts
 * import { debug } from "@lglen/bing-image-search";
 * debug.enable();
 * debug.setHandler((entry) => {
 *   console.log(JSON.stringify(entry));
 * });
 * ```
 *
 * @packageDocumentation
 */

// ─── Types ───────────────────────────────────────────────────────────

/** Log severity levels. */
export type LogLevel = "off" | "error" | "warn" | "info" | "debug" | "trace";

/** Structured log entry passed to custom handlers. */
export interface LogEntry {
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Severity level. */
  level: LogLevel;
  /** Module that produced the log (e.g. "bing", "bing-media"). */
  module: string;
  /** Human-readable message. */
  message: string;
  /** Optional structured data payload. */
  data?: unknown;
}

/** Custom log handler — replace the default console output. */
export type LogHandler = (entry: LogEntry) => void;

// ─── State ───────────────────────────────────────────────────────────

const LEVEL_RANK: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

let currentLevel: LogLevel = "off";
let currentHandler: LogHandler = defaultHandler;

function defaultHandler(entry: LogEntry): void {
  const prefix = `[${entry.timestamp}] [${entry.module}]`;
  switch (entry.level) {
    case "error":
      console.error(prefix, entry.message, entry.data ?? "");
      break;
    case "warn":
      console.warn(prefix, entry.message, entry.data ?? "");
      break;
    case "info":
    case "debug":
    case "trace":
      console.log(prefix, entry.message, entry.data ?? "");
      break;
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] <= LEVEL_RANK[currentLevel];
}

function emit(level: LogLevel, module: string, message: string, data?: unknown): void {
  if (!shouldLog(level)) return;
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    data,
  };
  currentHandler(entry);
}

// ─── Public API (consumer-facing) ────────────────────────────────────

/** Global debug configuration. */
export const debug = {
  /** Enable debug logging at the given level (default "debug"). */
  enable(level: LogLevel = "debug"): void {
    currentLevel = level;
  },

  /** Disable all debug logging. */
  disable(): void {
    currentLevel = "off";
  },

  /** Set the minimum log level. */
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },

  /** Get the current log level. */
  getLevel(): LogLevel {
    return currentLevel;
  },

  /**
   * Replace the default console-based handler with a custom one.
   * Useful for integrating with Firebase Cloud Logging, pino, winston, etc.
   *
   * @example
   * ```ts
   * debug.setHandler((entry) => {
   *   functions.logger.log(entry.message, { ...entry });
   * });
   * ```
   */
  setHandler(handler: LogHandler): void {
    currentHandler = handler;
  },
};

// ─── Internal API (used by modules) ──────────────────────────────────

/** A logger scoped to a specific module. Created via `createLogger("modulename")`. */
export interface Logger {
  trace(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/**
 * Create a logger scoped to a module name.
 * Internal use only — modules call this once at the top of their file.
 */
export function createLogger(module: string): Logger {
  return {
    trace(message: string, data?: unknown) {
      emit("trace", module, message, data);
    },
    debug(message: string, data?: unknown) {
      emit("debug", module, message, data);
    },
    info(message: string, data?: unknown) {
      emit("info", module, message, data);
    },
    warn(message: string, data?: unknown) {
      emit("warn", module, message, data);
    },
    error(message: string, data?: unknown) {
      emit("error", module, message, data);
    },
  };
}
