/**
 * Shared text formatting utilities.
 */

/** Get initials from a name (first letter of first + last name). */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  if (parts.length === 1) return first[0]?.toUpperCase() ?? "";
  const last = parts[parts.length - 1] ?? "";
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

/** Format a date string (YYYY-MM-DD) to a readable locale format. */
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}
