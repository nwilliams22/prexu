/**
 * Application logger that writes to Tauri log files.
 *
 * Log files are written to the app's log directory:
 *   Windows: %APPDATA%/com.prexu.app/logs/
 *   macOS:   ~/Library/Logs/com.prexu.app/
 *   Linux:   ~/.config/com.prexu.app/logs/
 */

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

export const logger = {
  async info(tag: string, message: string, data?: unknown) {
    const msg = formatMessage(tag, message, data);
    console.log(msg);
    const log = await getTauriLog();
    log?.info(msg);
  },

  async warn(tag: string, message: string, data?: unknown) {
    const msg = formatMessage(tag, message, data);
    console.warn(msg);
    const log = await getTauriLog();
    log?.warn(msg);
  },

  async error(tag: string, message: string, data?: unknown) {
    const msg = formatMessage(tag, message, data);
    console.error(msg);
    const log = await getTauriLog();
    log?.error(msg);
  },

  async debug(tag: string, message: string, data?: unknown) {
    const msg = formatMessage(tag, message, data);
    console.debug(msg);
    const log = await getTauriLog();
    log?.debug(msg);
  },
};
