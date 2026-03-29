/**
 * Storage helpers for Watch Together invite notification settings.
 */

import { STORAGE_KEYS, localStore } from "./backends";

/** Built-in notification sound identifiers */
export type BuiltinSound = "chime" | "bell" | "pop" | "ping" | "soft";

export interface NotificationSoundConfig {
  /** Built-in sound name, or "custom" if using a user-provided file */
  sound: BuiltinSound | "custom";
  /** Display name of custom audio file */
  customPath?: string;
  /** Base64 data URL of the custom audio file (persisted in store) */
  customDataUrl?: string;
}

const DEFAULT_VOLUME = 0.5;
const DEFAULT_SOUND: NotificationSoundConfig = { sound: "chime" };

/** Get the invite notification volume (0–1). Defaults to 0.5. */
export async function getInviteVolume(): Promise<number> {
  const vol = await localStore.get<number>(STORAGE_KEYS.INVITE_NOTIFICATION_VOLUME);
  return vol ?? DEFAULT_VOLUME;
}

/** Save the invite notification volume (0–1). */
export async function saveInviteVolume(volume: number): Promise<void> {
  await localStore.set(STORAGE_KEYS.INVITE_NOTIFICATION_VOLUME, Math.max(0, Math.min(1, volume)));
}

/** Get the invite notification sound config. */
export async function getInviteSoundConfig(): Promise<NotificationSoundConfig> {
  const config = await localStore.get<NotificationSoundConfig>(
    STORAGE_KEYS.INVITE_NOTIFICATION_SOUND,
  );
  return config ?? DEFAULT_SOUND;
}

/** Save the invite notification sound config. */
export async function saveInviteSoundConfig(config: NotificationSoundConfig): Promise<void> {
  await localStore.set(STORAGE_KEYS.INVITE_NOTIFICATION_SOUND, config);
}
