/**
 * Parental controls storage: per-user content rating restrictions set by admin.
 */

import type { ParentalControlSettings } from "../../types/parental-controls";
import { DEFAULT_PARENTAL_CONTROLS } from "../../types/parental-controls";
import { STORAGE_KEYS, localStore } from "./backends";

function parentalKey(userId: number): string {
  return `${STORAGE_KEYS.PARENTAL_CONTROLS}_${userId}`;
}

export async function getParentalControls(
  userId: number,
): Promise<ParentalControlSettings> {
  const saved = await localStore.get<ParentalControlSettings>(parentalKey(userId));
  return saved ?? { ...DEFAULT_PARENTAL_CONTROLS };
}

export async function saveParentalControls(
  userId: number,
  settings: ParentalControlSettings,
): Promise<void> {
  await localStore.set(parentalKey(userId), settings);
}
