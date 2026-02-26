/**
 * Plex OAuth authentication using the PIN-based flow.
 *
 * Flow:
 * 1. POST /api/v2/pins to create a PIN
 * 2. Open browser to app.plex.tv/auth with the PIN code
 * 3. Poll GET /api/v2/pins/{id} until authToken is returned
 */

import type { PlexPin } from "../types/plex";
import { getClientIdentifier } from "./storage";

const PLEX_API_BASE = "https://clients.plex.tv/api/v2";
const APP_NAME = "Prexu";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 300000; // 5 minutes

/** Build the common Plex headers required for all API calls */
async function getPlexHeaders(): Promise<Record<string, string>> {
  const clientId = await getClientIdentifier();
  return {
    Accept: "application/json",
    "X-Plex-Product": APP_NAME,
    "X-Plex-Version": "0.1.0",
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Platform": "Web",
  };
}

/** Create a new PIN for authentication */
export async function createPin(): Promise<PlexPin> {
  const headers = await getPlexHeaders();

  const response = await fetch(`${PLEX_API_BASE}/pins`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "strong=true",
  });

  if (!response.ok) {
    throw new Error(`Failed to create PIN: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<PlexPin>;
}

/** Get the Plex auth URL to open in the browser */
export async function getAuthUrl(pinCode: string): Promise<string> {
  const clientId = await getClientIdentifier();
  const params = new URLSearchParams({
    clientID: clientId,
    code: pinCode,
    "context[device][product]": APP_NAME,
  });
  return `https://app.plex.tv/auth#?${params.toString()}`;
}

/** Poll a PIN until the user authenticates or the PIN expires */
export async function pollForAuth(pinId: number): Promise<string> {
  const headers = await getPlexHeaders();
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    const response = await fetch(`${PLEX_API_BASE}/pins/${pinId}`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to check PIN: ${response.status}`);
    }

    const pin = (await response.json()) as PlexPin;

    if (pin.authToken) {
      return pin.authToken;
    }

    // Check if the PIN has expired
    if (new Date(pin.expiresAt) < new Date()) {
      throw new Error("Authentication timed out. The PIN has expired.");
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Authentication timed out. Please try again.");
}
