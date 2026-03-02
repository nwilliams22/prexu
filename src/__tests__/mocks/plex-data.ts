/**
 * Factory functions for creating mock Plex data objects.
 * Each function produces a complete, valid object with sensible defaults.
 * Pass Partial<T> overrides to customize specific fields.
 */

import type {
  PlexMediaItem,
  PlexMovie,
  PlexShow,
  PlexSeason,
  PlexEpisode,
  PlexMediaInfo,
  PlexMediaPart,
  PlexStream,
  PlexChapter,
  PlexCollection,
  PlexPlaylist,
  LibrarySection,
  GroupedRecentItem,
} from "../../types/library";
import type {
  PlexPin,
  PlexConnection,
  PlexResource,
  PlexServer,
  AuthData,
  ServerData,
} from "../../types/plex";
import type { Preferences } from "../../types/preferences";
import type { HomeUser, ActiveUser } from "../../types/home-user";
import type { WatchParticipant, WatchInvite, WatchSession } from "../../types/watch-together";

// ── Counter for unique IDs ──

let idCounter = 1;
function nextId(): number {
  return idCounter++;
}
function nextKey(): string {
  return String(nextId());
}

/** Reset ID counter between tests */
export function resetIdCounter(): void {
  idCounter = 1;
}

// ── Library Section ──

export function createLibrarySection(
  overrides: Partial<LibrarySection> = {}
): LibrarySection {
  const id = nextKey();
  return {
    key: id,
    title: `Library ${id}`,
    type: "movie",
    agent: "tv.plex.agents.movie",
    scanner: "Plex Movie",
    thumb: `/library/sections/${id}/thumb`,
    art: `/library/sections/${id}/art`,
    updatedAt: 1700000000,
    ...overrides,
  };
}

// ── Streams ──

export function createPlexStream(
  overrides: Partial<PlexStream> = {}
): PlexStream {
  const id = nextId();
  return {
    id,
    streamType: 1,
    codec: "h264",
    index: 0,
    displayTitle: "1080p (H.264)",
    language: "English",
    languageCode: "eng",
    ...overrides,
  };
}

// ── Chapters ──

export function createPlexChapter(
  overrides: Partial<PlexChapter> = {}
): PlexChapter {
  const id = nextId();
  return {
    id,
    index: 1,
    startTimeOffset: 0,
    endTimeOffset: 300000,
    tag: `Chapter ${id}`,
    ...overrides,
  };
}

// ── Media Parts ──

export function createPlexMediaPart(
  overrides: Partial<PlexMediaPart> = {}
): PlexMediaPart {
  const id = nextId();
  return {
    id,
    key: `/library/parts/${id}/file.mp4`,
    duration: 7200000,
    file: "/media/movies/Movie.mp4",
    size: 4000000000,
    container: "mp4",
    Stream: [
      createPlexStream({ streamType: 1, codec: "h264" }),
      createPlexStream({ streamType: 2, codec: "aac", displayTitle: "English (AAC Stereo)" }),
    ],
    ...overrides,
  };
}

// ── Media Info ──

export function createPlexMediaInfo(
  overrides: Partial<PlexMediaInfo> = {}
): PlexMediaInfo {
  const id = nextId();
  return {
    id,
    duration: 7200000,
    bitrate: 8000,
    videoResolution: "1080",
    videoCodec: "h264",
    audioCodec: "aac",
    audioChannels: 2,
    Part: [createPlexMediaPart()],
    ...overrides,
  };
}

// ── Base Media Item ──

export function createPlexMediaItem(
  overrides: Partial<PlexMediaItem> = {}
): PlexMediaItem {
  const key = nextKey();
  return {
    ratingKey: key,
    key: `/library/metadata/${key}`,
    type: "movie",
    title: `Media Item ${key}`,
    summary: "A test media item",
    thumb: `/library/metadata/${key}/thumb`,
    art: `/library/metadata/${key}/art`,
    addedAt: 1700000000,
    updatedAt: 1700000000,
    ...overrides,
  };
}

// ── Movies ──

export function createPlexMovie(
  overrides: Partial<PlexMovie> = {}
): PlexMovie {
  const key = nextKey();
  return {
    ratingKey: key,
    key: `/library/metadata/${key}`,
    type: "movie",
    title: `Movie ${key}`,
    summary: "A test movie",
    thumb: `/library/metadata/${key}/thumb`,
    art: `/library/metadata/${key}/art`,
    addedAt: 1700000000,
    updatedAt: 1700000000,
    year: 2024,
    rating: 8.5,
    audienceRating: 9.0,
    contentRating: "PG-13",
    duration: 7200000,
    tagline: "A great movie",
    studio: "Test Studio",
    Genre: [{ tag: "Action" }, { tag: "Adventure" }],
    Director: [{ tag: "Test Director" }],
    Writer: [{ tag: "Test Writer" }],
    Role: [{ tag: "Actor One", role: "Hero", thumb: "/thumb/actor1" }],
    Media: [createPlexMediaInfo()],
    ...overrides,
  };
}

// ── Shows ──

export function createPlexShow(
  overrides: Partial<PlexShow> = {}
): PlexShow {
  const key = nextKey();
  return {
    ratingKey: key,
    key: `/library/metadata/${key}`,
    type: "show",
    title: `Show ${key}`,
    summary: "A test show",
    thumb: `/library/metadata/${key}/thumb`,
    art: `/library/metadata/${key}/art`,
    addedAt: 1700000000,
    updatedAt: 1700000000,
    year: 2024,
    rating: 8.0,
    audienceRating: 8.5,
    contentRating: "TV-14",
    childCount: 3,
    leafCount: 30,
    viewedLeafCount: 10,
    studio: "Test Network",
    Genre: [{ tag: "Drama" }],
    Role: [{ tag: "Actor Two", role: "Lead" }],
    ...overrides,
  };
}

// ── Seasons ──

export function createPlexSeason(
  overrides: Partial<PlexSeason> = {}
): PlexSeason {
  const key = nextKey();
  return {
    ratingKey: key,
    key: `/library/metadata/${key}`,
    type: "season",
    title: "Season 1",
    summary: "",
    thumb: `/library/metadata/${key}/thumb`,
    art: "",
    addedAt: 1700000000,
    updatedAt: 1700000000,
    index: 1,
    parentRatingKey: "100",
    parentTitle: "Parent Show",
    leafCount: 10,
    viewedLeafCount: 5,
    parentThumb: "/library/metadata/100/thumb",
    ...overrides,
  };
}

// ── Episodes ──

export function createPlexEpisode(
  overrides: Partial<PlexEpisode> = {}
): PlexEpisode {
  const key = nextKey();
  return {
    ratingKey: key,
    key: `/library/metadata/${key}`,
    type: "episode",
    title: `Episode ${key}`,
    summary: "A test episode",
    thumb: `/library/metadata/${key}/thumb`,
    art: "",
    addedAt: 1700000000,
    updatedAt: 1700000000,
    index: 1,
    parentIndex: 1,
    parentRatingKey: "200",
    grandparentRatingKey: "100",
    grandparentTitle: "Test Show",
    grandparentThumb: "/library/metadata/100/thumb",
    grandparentArt: "/library/metadata/100/art",
    parentTitle: "Season 1",
    year: 2024,
    contentRating: "TV-14",
    duration: 2700000,
    originallyAvailableAt: "2024-01-15",
    Media: [createPlexMediaInfo({ duration: 2700000 })],
    Role: [],
    Director: [],
    Writer: [],
    ...overrides,
  };
}

// ── Collections ──

export function createPlexCollection(
  overrides: Partial<PlexCollection> = {}
): PlexCollection {
  const key = nextKey();
  return {
    ratingKey: key,
    key: `/library/collections/${key}/children`,
    type: "collection",
    title: `Collection ${key}`,
    summary: "A test collection",
    thumb: `/library/collections/${key}/thumb`,
    art: "",
    childCount: 5,
    subtype: "movie",
    addedAt: 1700000000,
    updatedAt: 1700000000,
    ...overrides,
  };
}

// ── Playlists ──

export function createPlexPlaylist(
  overrides: Partial<PlexPlaylist> = {}
): PlexPlaylist {
  const key = nextKey();
  return {
    ratingKey: key,
    key: `/playlists/${key}/items`,
    type: "playlist",
    title: `Playlist ${key}`,
    summary: "A test playlist",
    thumb: "",
    composite: `/playlists/${key}/composite`,
    playlistType: "video",
    leafCount: 10,
    duration: 36000000,
    smart: false,
    addedAt: 1700000000,
    updatedAt: 1700000000,
    ...overrides,
  };
}

// ── Grouped Recent Item ──

export function createGroupedRecentItem(
  overrides: Partial<GroupedRecentItem> = {}
): GroupedRecentItem {
  const movie = createPlexMovie();
  return {
    kind: "movie",
    representativeItem: movie,
    groupKey: movie.ratingKey,
    title: movie.title,
    thumb: movie.thumb,
    episodes: [],
    episodeCount: 0,
    ...overrides,
  };
}

// ── Plex Auth Types ──

export function createPlexPin(
  overrides: Partial<PlexPin> = {}
): PlexPin {
  const id = nextId();
  return {
    id,
    code: `PIN${id}`,
    product: "Prexu",
    trusted: false,
    clientIdentifier: "test-client-id",
    authToken: null,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    ...overrides,
  };
}

export function createPlexConnection(
  overrides: Partial<PlexConnection> = {}
): PlexConnection {
  return {
    protocol: "https",
    address: "192.168.1.100",
    port: 32400,
    uri: "https://192.168.1.100:32400",
    local: true,
    relay: false,
    ...overrides,
  };
}

export function createPlexResource(
  overrides: Partial<PlexResource> = {}
): PlexResource {
  return {
    name: "Test Server",
    product: "Plex Media Server",
    productVersion: "1.40.0",
    platform: "Linux",
    platformVersion: "5.15",
    device: "PC",
    clientIdentifier: "test-server-id",
    provides: "server",
    owned: true,
    accessToken: "test-server-token",
    connections: [createPlexConnection()],
    ...overrides,
  };
}

export function createPlexServer(
  overrides: Partial<PlexServer> = {}
): PlexServer {
  return {
    name: "Test Server",
    clientIdentifier: "test-server-id",
    accessToken: "test-server-token",
    uri: "https://192.168.1.100:32400",
    local: true,
    owned: true,
    status: "online",
    ...overrides,
  };
}

export function createAuthData(
  overrides: Partial<AuthData> = {}
): AuthData {
  return {
    authToken: "test-auth-token",
    clientIdentifier: "test-client-id",
    ...overrides,
  };
}

export function createServerData(
  overrides: Partial<ServerData> = {}
): ServerData {
  return {
    name: "Test Server",
    clientIdentifier: "test-server-id",
    accessToken: "test-server-token",
    uri: "https://192.168.1.100:32400",
    ...overrides,
  };
}

// ── Home Users ──

export function createHomeUser(
  overrides: Partial<HomeUser> = {}
): HomeUser {
  const id = nextId();
  return {
    id,
    uuid: `user-uuid-${id}`,
    title: `User ${id}`,
    username: `user${id}`,
    thumb: `https://plex.tv/users/${id}/avatar`,
    admin: false,
    guest: false,
    restricted: false,
    home: true,
    protected: false,
    ...overrides,
  };
}

export function createActiveUser(
  overrides: Partial<ActiveUser> = {}
): ActiveUser {
  const id = nextId();
  return {
    id,
    title: `User ${id}`,
    username: `user${id}`,
    thumb: `https://plex.tv/users/${id}/avatar`,
    isAdmin: false,
    isHomeUser: true,
    ...overrides,
  };
}

// ── Watch Together ──

export function createWatchParticipant(
  overrides: Partial<WatchParticipant> = {}
): WatchParticipant {
  return {
    plexUsername: "testuser",
    plexThumb: "https://plex.tv/users/1/avatar",
    isHost: false,
    state: "ready",
    ...overrides,
  };
}

export function createWatchInvite(
  overrides: Partial<WatchInvite> = {}
): WatchInvite {
  return {
    sessionId: `session-${nextId()}`,
    mediaTitle: "Test Movie",
    mediaRatingKey: "500",
    mediaType: "movie",
    senderUsername: "friend",
    senderThumb: "https://plex.tv/users/2/avatar",
    sentAt: Date.now(),
    relayUrl: "ws://localhost:9847/ws",
    ...overrides,
  };
}

export function createWatchSession(
  overrides: Partial<WatchSession> = {}
): WatchSession {
  return {
    sessionId: `session-${nextId()}`,
    mediaTitle: "Test Movie",
    mediaRatingKey: "500",
    mediaType: "movie",
    isHost: true,
    participants: [
      createWatchParticipant({ isHost: true, plexUsername: "hostuser" }),
    ],
    ...overrides,
  };
}

// ── Preferences ──

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export function createPreferences(
  overrides: DeepPartial<Preferences> = {}
): Preferences {
  const dashboardSections = {
    continueWatching: true,
    recentMovies: true,
    recentShows: true,
    ...overrides.appearance?.dashboardSections,
  };

  return {
    playback: {
      quality: "1080p",
      preferredAudioLanguage: "eng",
      preferredSubtitleLanguage: "",
      defaultSubtitles: "auto",
      subtitleSize: 100,
      audioBoost: 100,
      directPlayPreference: "auto",
      ...overrides.playback,
    },
    appearance: {
      posterSize: "medium",
      sidebarCollapsed: false,
      ...overrides.appearance,
      dashboardSections,
    },
  };
}
