/**
 * Client identifier storage.
 */

import { STORAGE_KEYS, localStore } from "./backends";

/** Get or create a persistent client identifier for this device */
export async function getClientIdentifier(): Promise<string> {
  let clientId = await localStore.get<string>(STORAGE_KEYS.CLIENT_ID);
  if (!clientId) {
    clientId = crypto.randomUUID();
    await localStore.set(STORAGE_KEYS.CLIENT_ID, clientId);
  }
  return clientId;
}
