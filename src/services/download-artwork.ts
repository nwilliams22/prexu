import type { LazyStore } from "@tauri-apps/plugin-store";
import type { DownloadItem } from "../types/downloads";
import { getImageUrl } from "./plex-library/images";

// Keep image bytes out of localStorage's small quota and out of auth storage.
// Explicit saves make a completed write durable before process shutdown.
let storePromise: Promise<LazyStore> | undefined;
function store() {
  storePromise ??= import("@tauri-apps/plugin-store").then(({ LazyStore }) =>
    new LazyStore("download-artwork.json", { defaults: {}, autoSave: false }),
  );
  return storePromise;
}

type ArtworkItem = Pick<DownloadItem, "serverUri" | "ratingKey" | "thumb">;
export function artworkKey(item: Pick<DownloadItem, "serverUri" | "ratingKey">): string {
  return JSON.stringify([item.serverUri, item.ratingKey]);
}

// Serialise each item's writes and deletion, including a still-running fetch.
// Deleting during a request must not let its late result recreate the asset.
const operations = new Map<string, Promise<unknown>>();
function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
  const pending = (operations.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
  operations.set(key, pending);
  void pending.finally(() => {
    if (operations.get(key) === pending) operations.delete(key);
  }).catch(() => {});
  return pending;
}

const MAX_BYTES = 256 * 1024;
async function fetchArtwork(item: ArtworkItem, token: string): Promise<string> {
  const { fetch } = await import("@tauri-apps/plugin-http");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const url = new URL(getImageUrl(item.serverUri, "", item.thumb, 80, 120));
    url.searchParams.delete("X-Plex-Token");
    const response = await fetch(url.toString(), {
      headers: { "X-Plex-Token": token },
      signal: controller.signal,
      maxRedirections: 0,
      connectTimeout: 5000,
    });
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (!response.ok || !mime || !["image/jpeg", "image/png", "image/webp"].includes(mime)) {
      throw new Error("Artwork response is not a supported image");
    }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Artwork too large");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Artwork response has no body");
    let binary = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (binary.length + value.length > MAX_BYTES) throw new Error("Artwork too large");
        for (const byte of value) binary += String.fromCharCode(byte);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (!binary.length) throw new Error("Artwork response is empty");
    return `data:${mime};base64,${btoa(binary)}`;
  } finally {
    clearTimeout(timer);
  }
}

/** Read locally first. Only the matching server's credential may fill a miss. */
export function loadDownloadArtwork(item: ArtworkItem, token?: string): Promise<string | undefined> {
  if (!("__TAURI_INTERNALS__" in window)) return Promise.resolve(undefined);
  return serial(artworkKey(item), async () => {
    const cache = await store();
    const saved = await cache.get<string>(artworkKey(item));
    if (saved) return saved;
    if (!token || !item.thumb) return undefined;
    const data = await fetchArtwork(item, token);
    await cache.set(artworkKey(item), data);
    await cache.save();
    return data;
  });
}

export function deleteDownloadArtwork(item: ArtworkItem): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return Promise.resolve();
  return serial(artworkKey(item), async () => {
    const cache = await store();
    await cache.delete(artworkKey(item));
    await cache.save();
  });
}

/** Reconcile after a crash between metadata deletion and the cache save. */
export async function pruneDownloadArtwork(items: ArtworkItem[]): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const cache = await store();
  const retained = new Set(items.map(artworkKey));
  for (const key of await cache.keys()) {
    if (!retained.has(key)) {
      await serial(key, async () => { await cache.delete(key); await cache.save(); });
    }
  }
}
