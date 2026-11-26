import type { DownloadItem } from "../types/downloads";
import { getDownloadStorage } from "./downloads";
import { formatBytes } from "../components/downloads/format";

export function requiredDownloadBytes(items: DownloadItem[], existing: DownloadItem[]): number {
  const reserved = existing.filter((item) => ["queued", "downloading", "paused"].includes(item.status));
  return [...reserved, ...items].reduce((sum, item) => sum + Math.max(0, item.fileSize - item.bytesDownloaded), 0);
}

/** Native dialog element provides focus containment and Escape cancellation. */
export function confirmStorageWarning(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const trigger = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Download storage warning");
    dialog.style.cssText = "margin:auto;padding:24px;max-width:440px;border-radius:12px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary)";
    const title = document.createElement("h3");
    title.textContent = "Download storage warning";
    const body = document.createElement("p");
    body.textContent = message;
    body.style.cssText = "margin:16px 0";
    const finish = (accepted: boolean) => {
      dialog.close();
      dialog.remove();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
      resolve(accepted);
    };
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.autofocus = true;
    cancel.onclick = () => finish(false);
    const proceed = document.createElement("button");
    proceed.textContent = "Download anyway";
    proceed.onclick = () => finish(true);
    for (const button of [cancel, proceed]) {
      button.style.cssText = "padding:8px 12px;margin-right:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);cursor:pointer";
    }
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    dialog.append(title, body, cancel, proceed);
    document.body.append(dialog);
    dialog.showModal();
  });
}

export async function confirmDownloadCapacity(items: DownloadItem[], existing: DownloadItem[]): Promise<boolean> {
  const required = requiredDownloadBytes(items, existing);
  let free: number;
  try {
    free = (await getDownloadStorage()).freeBytes;
  } catch {
    return confirmStorageWarning("Could not check free space on the download drive. Cancel to check the drive, or download anyway.");
  }
  if (required > free) {
    return confirmStorageWarning(`These downloads and the pending queue need ${formatBytes(required)}. Only ${formatBytes(free)} is free on the download drive. The downloads may fail. Cancel to free space, or download anyway.`);
  }
  if (items.some((item) => item.fileSize <= 0)) {
    return confirmStorageWarning("Some download sizes are unknown. There may not be enough free space. Cancel to check the drive, or download anyway.");
  }
  return true;
}
