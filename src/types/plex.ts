/** Response from POST /api/v2/pins */
export interface PlexPin {
  id: number;
  code: string;
  product: string;
  trusted: boolean;
  clientIdentifier: string;
  authToken: string | null;
  expiresAt: string;
}

/** A connection URI for a Plex server */
export interface PlexConnection {
  protocol: string;
  address: string;
  port: number;
  uri: string;
  local: boolean;
  relay: boolean;
}

/** A Plex resource (server, player, etc.) from /api/v2/resources */
export interface PlexResource {
  name: string;
  product: string;
  productVersion: string;
  platform: string;
  platformVersion: string;
  device: string;
  clientIdentifier: string;
  provides: string;
  owned: boolean;
  accessToken: string;
  connections: PlexConnection[];
}

/** A resolved server we can actually connect to */
export interface PlexServer {
  name: string;
  clientIdentifier: string;
  accessToken: string;
  uri: string;
  local: boolean;
  owned: boolean;
  status: "online" | "offline" | "checking";
}

/** Auth state stored persistently */
export interface AuthData {
  authToken: string;
  clientIdentifier: string;
}

/** Selected server stored persistently */
export interface ServerData {
  name: string;
  clientIdentifier: string;
  accessToken: string;
  uri: string;
}
