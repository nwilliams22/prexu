/**
 * Application logger that writes to Tauri log files.
 *
 * Log files are written to the app's log directory:
 *   Windows: %APPDATA%/com.prexu.app/logs/
 *   macOS:   ~/Library/Logs/com.prexu.app/
 *   Linux:   ~/.config/com.prexu.app/logs/
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

/**
 * Client-side minimum level. Release builds gate at "info" to match the Rust
 * side (tauri-plugin-log filters debug/trace in release anyway — gating here
 * avoids paying JSON.stringify + console + IPC on every hot-path call).
 * Dev passes everything through.
 */
let minLevel: LogLevel = import.meta.env.PROD ? "info" : "trace";

/** Test-only override for the minimum log level. */
export function setLogLevel(level: LogLevel) {
  minLevel = level;
}

function isEnabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

let tauriLog: typeof import("@tauri-apps/plugin-log") | null = null;

// Lazy-load the Tauri log plugin (fails gracefully in browser/test)
async function getTauriLog() {
  if (tauriLog) return tauriLog;
  try {
    tauriLog = await import("@tauri-apps/plugin-log");
    return tauriLog;
  } catch {
    return null;
  }
}

/**
 * Redact Plex auth tokens from a URL before logging, then truncate.
 *
 * Naive truncation (e.g. `url.substring(0, 80)`) leaks token prefixes when
 * the server URI is short, because the X-Plex-Token query param lands inside
 * the truncation window. Always run URLs through this before logging them.
 */
export function redactUrl(url: string): string {
  return url.replace(/X-Plex-Token=[^&]*/gi, "X-Plex-Token=***").substring(0, 100);
}

function formatMessage(tag: string, message: string, data?: unknown): string {
  const parts = [`[${tag}] ${message}`];
  if (data !== undefined) {
    try {
      parts.push(typeof data === "string" ? data : JSON.stringify(data));
    } catch {
      parts.push(String(data));
    }
  }
  return parts.join(" ");
}

/** Fire a Tauri log call, swallowing errors when the IPC bridge is
 *  unavailable (tests, browser-only mode). */
async function tauriCall(fn: (log: NonNullable<typeof tauriLog>) => Promise<void>) {
  try {
    const log = await getTauriLog();
    if (log) await fn(log);
  } catch {
    // Tauri IPC unavailable (test / browser-only) — console already has it.
  }
}

export const logger = {
  async info(tag: string, message: string, data?: unknown) {
    if (!isEnabled("info")) return;
    const msg = formatMessage(tag, message, data);
    console.log(msg);
    await tauriCall((log) => log.info(msg));
  },

  async warn(tag: string, message: string, data?: unknown) {
    if (!isEnabled("warn")) return;
    const msg = formatMessage(tag, message, data);
    console.warn(msg);
    await tauriCall((log) => log.warn(msg));
  },

  async error(tag: string, message: string, data?: unknown) {
    if (!isEnabled("error")) return;
    const msg = formatMessage(tag, message, data);
    console.error(msg);
    await tauriCall((log) => log.error(msg));
  },

  async debug(tag: string, message: string, data?: unknown) {
    if (!isEnabled("debug")) return;
    const msg = formatMessage(tag, message, data);
    console.debug(msg);
    await tauriCall((log) => log.debug(msg));
  },

  async trace(tag: string, message: string, data?: unknown) {
    if (!isEnabled("trace")) return;
    const msg = formatMessage(tag, message, data);
    console.debug(msg);
    await tauriCall((log) => log.trace(msg));
  },
};
