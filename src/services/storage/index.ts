/**
 * Storage abstraction layer — barrel re-export.
 *
 * All consumers import from "services/storage" which resolves here.
 * Internal modules are organized by domain:
 *   - backends.ts  — secure store, localStorage, migration
 *   - auth.ts      — auth tokens, admin auth, active user
 *   - server.ts    — server data, relay URL
 *   - preferences.ts — global and per-user preferences
 *   - content.ts   — content requests, dismissed recommendations
 *   - client.ts    — client identifier
 */

export { migrateToSecureStorage } from "./backends";
export {
  saveAuth,
  getAuth,
  clearAuth,
  saveAdminAuth,
  getAdminAuth,
  clearAdminAuth,
  saveActiveUser,
  getActiveUser,
  clearActiveUser,
} from "./auth";
export {
  saveServer,
  getServer,
  clearServer,
  deriveRelayUrl,
  getRelayUrl,
  saveRelayUrl,
  clearRelayUrl,
  hasManualRelayUrl,
  getRelayHttpUrl,
} from "./server";
export {
  getDefaultPreferences,
  getPreferences,
  savePreferences,
  getUserPreferences,
  saveUserPreferences,
} from "./preferences";
export {
  getContentRequests,
  saveContentRequests,
  getRequestsLastRead,
  saveRequestsLastRead,
  getDismissedRecommendations,
  saveDismissedRecommendations,
} from "./content";
export { getClientIdentifier } from "./client";
export {
  getRecentSearches,
  saveRecentSearches,
  addRecentSearch,
  removeRecentSearch,
} from "./search";
export {
  getLastSeenTimestamps,
  saveLastSeenTimestamps,
  markSectionSeen,
  markAllSectionsSeen,
  getAppLastLaunch,
  saveAppLastLaunch,
} from "./new-content";
export {
  getParentalControls,
  saveParentalControls,
} from "./parental-controls";
