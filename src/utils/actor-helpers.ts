/**
 * Pure utility functions for actor detail calculations.
 */

/** Calculate age from birthday (and optional deathday). */
export function calcAge(birthday: string | null, deathday: string | null): number | null {
  if (!birthday) return null;
  const birth = new Date(birthday + "T00:00:00");
  const end = deathday ? new Date(deathday + "T00:00:00") : new Date();
  let age = end.getFullYear() - birth.getFullYear();
  const m = end.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && end.getDate() < birth.getDate())) age--;
  return age;
}

/** Get year from a date string (YYYY-MM-DD or similar). */
export function getYear(dateStr?: string): number {
  if (!dateStr) return 0;
  return parseInt(dateStr.slice(0, 4), 10) || 0;
}
