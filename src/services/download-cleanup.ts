/** Plex lastViewedAt is seconds; all cleanup times are milliseconds. */
export const WATCHED_DOWNLOAD_GRACE_MS = 24 * 60 * 60 * 1000;
export function isWatchedDownloadEligible(options: {
  enabled: boolean;
  complete: boolean;
  watched: boolean;
  watchedAt: number | undefined;
  sessionStartedAt: number;
  protectedThisSession: boolean;
  startup: boolean;
  now: number;
}): boolean {
  const { enabled, complete, watched, watchedAt, sessionStartedAt, protectedThisSession, startup, now } = options;
  if (!enabled || !complete || !watched || protectedThisSession) return false;
  if (watchedAt === undefined || !Number.isFinite(watchedAt) || watchedAt <= 0) return false;
  // Never let the 24-hour timer override protection for this app session.
  if (watchedAt >= sessionStartedAt || watchedAt > now) return false;
  return startup || now - watchedAt >= WATCHED_DOWNLOAD_GRACE_MS;
}
