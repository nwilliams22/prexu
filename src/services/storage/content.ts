/**
 * Content request and recommendation storage.
 */

import type { ContentRequest } from "../../types/content-request";
import { STORAGE_KEYS, localStore } from "./backends";

// ── Content requests ──

export async function getContentRequests(): Promise<ContentRequest[]> {
  const requests = await localStore.get<ContentRequest[]>(STORAGE_KEYS.CONTENT_REQUESTS);
  return requests ?? [];
}

export async function saveContentRequests(requests: ContentRequest[]): Promise<void> {
  await localStore.set(STORAGE_KEYS.CONTENT_REQUESTS, requests);
}

export async function getRequestsLastRead(): Promise<number> {
  const ts = await localStore.get<number>(STORAGE_KEYS.REQUESTS_LAST_READ);
  return ts ?? 0;
}

export async function saveRequestsLastRead(timestamp: number): Promise<void> {
  await localStore.set(STORAGE_KEYS.REQUESTS_LAST_READ, timestamp);
}

// ── Dismissed recommendations ──

/** Get the set of dismissed recommendation ratingKeys */
export async function getDismissedRecommendations(): Promise<string[]> {
  const keys = await localStore.get<string[]>(STORAGE_KEYS.DISMISSED_RECOMMENDATIONS);
  return keys ?? [];
}

/** Save the set of dismissed recommendation ratingKeys */
export async function saveDismissedRecommendations(keys: string[]): Promise<void> {
  await localStore.set(STORAGE_KEYS.DISMISSED_RECOMMENDATIONS, keys);
}
