/**
 * Download metadata storage — tracks which items have been downloaded.
 */

import type { DownloadItem } from "../../types/downloads";
import { STORAGE_KEYS, localStore } from "./backends";

export async function getDownloadItems(): Promise<DownloadItem[]> {
  return (await localStore.get<DownloadItem[]>(STORAGE_KEYS.DOWNLOADS)) ?? [];
}

export async function saveDownloadItems(items: DownloadItem[]): Promise<void> {
  await localStore.set(STORAGE_KEYS.DOWNLOADS, items);
}
