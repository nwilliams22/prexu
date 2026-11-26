/**
 * Download service — wraps Tauri IPC calls for media downloads.
 * All functions no-op gracefully when not in a Tauri runtime.
 */

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("Downloads require the Tauri desktop app");
  }
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export async function getDownloadsDir(): Promise<string> {
  return invoke<string>("get_downloads_dir");
}

export async function startDownload(
  serverUrl: string,
  token: string,
  ratingKey: string,
  partKey: string,
  fileName: string,
  fileSize: number,
): Promise<void> {
  return invoke("download_media", {
    serverUrl,
    token,
    ratingKey,
    partKey,
    fileName,
    fileSize,
  });
}

export async function cancelDownload(ratingKey: string): Promise<void> {
  return invoke("cancel_download", { ratingKey });
}

export async function deleteDownload(ratingKey: string): Promise<void> {
  return invoke("delete_download", { ratingKey });
}

export async function getLocalFilePath(
  ratingKey: string,
): Promise<string | null> {
  return invoke<string | null>("get_local_file_path", { ratingKey });
}

export type DownloadQueueAction = "pause" | "pauseAll" | "resumeAll" | "reorder" | "limit";
export async function controlDownloadQueue(
  action: DownloadQueueAction,
  options: { ratingKey?: string; order?: string[]; limit?: number } = {},
): Promise<void> {
  return invoke("control_download_queue", { action, ...options });
}

export interface DownloadStorage {
  usedBytes: number;
  freeBytes: number;
}

export function getDownloadStorage(): Promise<DownloadStorage> {
  return invoke("get_download_storage");
}
