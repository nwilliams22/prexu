/**
 * Shared time formatting utilities.
 */

/** Format seconds into h:mm:ss or m:ss display string. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Format milliseconds into h:mm:ss or m:ss display string. */
export function formatTimeMs(ms: number): string {
  return formatTime(Math.floor(ms / 1000));
}

/** Format duration as "Xh Ymin" for display labels. */
export function formatDurationLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

/** Compute the "Ends at" time string, accounting for remaining time from now. */
export function getEndsAt(currentTime: number, duration: number): string {
  const remaining = Math.max(0, duration - currentTime);
  const end = new Date(Date.now() + remaining * 1000);
  return end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
