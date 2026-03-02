/** A user in the Plex Home (managed/guest users under one account) */
export interface HomeUser {
  id: number;
  uuid: string;
  title: string;        // Display name
  username: string;     // Empty for managed (non-account) users
  thumb: string;        // Avatar URL
  admin: boolean;       // Account owner?
  guest: boolean;
  restricted: boolean;  // Content restrictions?
  home: boolean;
  protected: boolean;   // Requires PIN to switch?
}

/** The currently active user profile (resolved after switch or initial load) */
export interface ActiveUser {
  id: number;
  title: string;
  username: string;
  thumb: string;
  isAdmin: boolean;
  isHomeUser: boolean;  // false if Plex Home not enabled
}
