import { useSyncExternalStore } from "react";

const KEY = "prexu.autoDeleteWatchedDownloads";
const EVENT = "prexu:download-cleanup-setting";
export const autoDeleteDownloadsEnabled = () => localStorage.getItem(KEY) === "true";
function subscribe(changed: () => void) {
  window.addEventListener(EVENT, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(EVENT, changed);
    window.removeEventListener("storage", changed);
  };
}
function setEnabled(enabled: boolean) {
  localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new Event(EVENT));
}
export function useAutoDeleteDownloads() {
  const enabled = useSyncExternalStore(subscribe, autoDeleteDownloadsEnabled, () => false);
  return [enabled, setEnabled] as const;
}
