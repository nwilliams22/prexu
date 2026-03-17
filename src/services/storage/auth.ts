/**
 * Authentication storage: auth tokens, admin auth, and active user.
 */

import type { AuthData } from "../../types/plex";
import type { ActiveUser } from "../../types/home-user";
import { STORAGE_KEYS, storageFor } from "./backends";

// ── Auth data ──

/** Save auth data after successful login */
export async function saveAuth(data: AuthData): Promise<void> {
  await storageFor(STORAGE_KEYS.AUTH).set(STORAGE_KEYS.AUTH, data);
}

/** Get stored auth data (returns null if not logged in) */
export async function getAuth(): Promise<AuthData | null> {
  return storageFor(STORAGE_KEYS.AUTH).get<AuthData>(STORAGE_KEYS.AUTH);
}

/** Clear auth data (logout) — removes auth, server, admin auth, and active user */
export async function clearAuth(): Promise<void> {
  await storageFor(STORAGE_KEYS.AUTH).remove(STORAGE_KEYS.AUTH);
  await storageFor(STORAGE_KEYS.SERVER).remove(STORAGE_KEYS.SERVER);
  await storageFor(STORAGE_KEYS.ADMIN_AUTH).remove(STORAGE_KEYS.ADMIN_AUTH);
  await storageFor(STORAGE_KEYS.ACTIVE_USER).remove(STORAGE_KEYS.ACTIVE_USER);
}

// ── Admin auth (preserved for switching back from managed user) ──

export async function saveAdminAuth(data: AuthData): Promise<void> {
  await storageFor(STORAGE_KEYS.ADMIN_AUTH).set(STORAGE_KEYS.ADMIN_AUTH, data);
}

export async function getAdminAuth(): Promise<AuthData | null> {
  return storageFor(STORAGE_KEYS.ADMIN_AUTH).get<AuthData>(STORAGE_KEYS.ADMIN_AUTH);
}

export async function clearAdminAuth(): Promise<void> {
  await storageFor(STORAGE_KEYS.ADMIN_AUTH).remove(STORAGE_KEYS.ADMIN_AUTH);
}

// ── Active user ──

export async function saveActiveUser(user: ActiveUser): Promise<void> {
  await storageFor(STORAGE_KEYS.ACTIVE_USER).set(STORAGE_KEYS.ACTIVE_USER, user);
}

export async function getActiveUser(): Promise<ActiveUser | null> {
  return storageFor(STORAGE_KEYS.ACTIVE_USER).get<ActiveUser>(STORAGE_KEYS.ACTIVE_USER);
}

export async function clearActiveUser(): Promise<void> {
  await storageFor(STORAGE_KEYS.ACTIVE_USER).remove(STORAGE_KEYS.ACTIVE_USER);
}
