import { redactUrl } from "../../services/logger";

/** Display only: never return malformed input, userinfo, query values or fragments. */
export function settingsAddress(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.hash = "";
    // All query values are private in this read-only summary; editing preserves them.
    for (const key of new Set(url.searchParams.keys())) url.searchParams.set(key, "***");
    return redactUrl(url.toString());
  } catch { return "Address unavailable"; }
}

export function validRelayAddress(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "ws:" || url.protocol === "wss:") && Boolean(url.hostname);
  } catch { return false; }
}
