// ── Library Section (from /library/sections) ──

export type LibraryType = "movie" | "show" | "artist" | "photo";

export interface LibrarySection {
  key: string;
  title: string;
  type: LibraryType;
  agent: string;
  scanner: string;
  thumb: string;
  art: string;
  updatedAt: number;
}

// ── Shared sub-types ──

export interface PlexTag {
  tag: string;
}

export interface PlexRole {
  tag: string;
  role: string;
  thumb?: string;
  id?: number;
  tagKey?: string;
}

export interface PlexStream {
  id: number;
  streamType: number; // 1=video, 2=audio, 3=subtitle
  codec: string;
  index: number;
  displayTitle: string;
  language?: string;
  languageCode?: string;
  selected?: boolean;
  default?: boolean;
  forced?: boolean;
  // Subtitle-specific
  key?: string; // URL to download external subtitle
  format?: string; // "srt", "ass", etc.
  // Audio-specific
  channels?: number;
  audioChannelLayout?: string;
  // Video-specific
  width?: number;
  height?: number;
  bitrate?: number;
}

export interface PlexChapter {
  id: number;
  index: number;
  startTimeOffset: number;
  endTimeOffset: number;
  tag: string;
}

export interface PlexMediaPart {
  id: number;
  key: string;
  duration: number;
  file: string;
  size: number;
  container: string;
  Stream?: PlexStream[];
  Chapter?: PlexChapter[];
}

export interface PlexMediaInfo {
  id: number;
  duration: number;
  bitrate: number;
  videoResolution: string;
  videoCodec: string;
  audioCodec: string;
  audioChannels: number;
  Part?: PlexMediaPart[];
}

// ── Base media item ──

export interface PlexMediaItem {
  ratingKey: string;
  key: string;
  type: string;
  title: string;
  summary: string;
  thumb: string;
  art: string;
  addedAt: number;
  updatedAt: number;
}

/** Individual rating entry from Plex (returned when includeRatings=1) */
export interface PlexRating {
  image: string; // e.g. "imdb://image.rating", "rottentomatoes://image.rating.ripe"
  value: number;
  type: string;  // "audience" or "critic"
}

// ── Movies ──

export interface PlexMovie extends PlexMediaItem {
  type: "movie";
  year: number;
  rating: number;
  audienceRating: number;
  ratingImage?: string;
  audienceRatingImage?: string;
  contentRating: string;
  duration: number;
  tagline: string;
  studio: string;
  viewOffset?: number;
  viewCount?: number;
  lastViewedAt?: number;
  Genre?: PlexTag[];
  Director?: PlexTag[];
  Writer?: PlexTag[];
  Role?: PlexRole[];
  Rating?: PlexRating[];
  Media?: PlexMediaInfo[];
}

// ── TV Shows ──

export interface PlexShow extends PlexMediaItem {
  type: "show";
  year: number;
  rating: number;
  audienceRating: number;
  ratingImage?: string;
  audienceRatingImage?: string;
  contentRating: string;
  childCount: number;
  leafCount: number;
  viewedLeafCount: number;
  studio: string;
  Genre?: PlexTag[];
  Role?: PlexRole[];
  Rating?: PlexRating[];
}

export interface PlexSeason extends PlexMediaItem {
  type: "season";
  index: number;
  parentRatingKey: string;
  parentTitle: string;
  leafCount: number;
  viewedLeafCount: number;
  parentThumb: string;
}

export interface PlexEpisode extends PlexMediaItem {
  type: "episode";
  index: number;
  parentIndex: number;
  parentRatingKey: string;
  grandparentRatingKey: string;
  grandparentTitle: string;
  grandparentThumb: string;
  grandparentArt: string;
  parentTitle: string;
  year: number;
  contentRating: string;
  duration: number;
  viewOffset?: number;
  viewCount?: number;
  originallyAvailableAt: string;
  rating?: number;
  audienceRating?: number;
  ratingImage?: string;
  audienceRatingImage?: string;
  Rating?: PlexRating[];
  Media?: PlexMediaInfo[];
  Role?: PlexRole[];
  Director?: PlexTag[];
  Writer?: PlexTag[];
}

// ── Music ──

export interface PlexArtist extends PlexMediaItem {
  type: "artist";
  Genre?: PlexTag[];
}

export interface PlexAlbum extends PlexMediaItem {
  type: "album";
  year: number;
  parentTitle: string;
  parentRatingKey: string;
  parentThumb: string;
  leafCount: number;
  Genre?: PlexTag[];
}

// ── API Response Wrappers ──

export interface PlexMediaContainer<T> {
  MediaContainer: {
    size: number;
    totalSize?: number;
    offset?: number;
    Metadata?: T[];
    Directory?: LibrarySection[];
    Hub?: PlexHub[];
  };
}

export interface PlexHub {
  hubKey: string;
  key: string;
  title: string;
  type: string;
  hubIdentifier: string;
  size: number;
  more: boolean;
  Metadata?: PlexMediaItem[];
}

// ── Grouped Recently Added (for dashboard) ──

export interface GroupedRecentItem {
  kind: "movie" | "show-group";
  representativeItem: PlexEpisode | PlexMovie;
  groupKey: string;
  title: string;
  thumb: string;
  episodes: PlexEpisode[];
  episodeCount: number;
  /** Season indices from season-level data (when episodes array is empty) */
  seasonIndices: number[];
}

// ── Collections ──

export interface PlexCollection {
  ratingKey: string;
  key: string;
  type: "collection";
  title: string;
  summary: string;
  thumb: string;
  art: string;
  childCount: number;
  subtype: string;
  addedAt: number;
  updatedAt: number;
}

// ── Playlists ──

export interface PlexPlaylist {
  ratingKey: string;
  key: string;
  type: "playlist";
  title: string;
  summary: string;
  thumb: string;
  composite: string;
  playlistType: string;
  leafCount: number;
  duration: number;
  smart: boolean;
  addedAt: number;
  updatedAt: number;
}

// ── Pagination ──

export interface PaginatedResult<T> {
  items: T[];
  totalSize: number;
  offset: number;
  hasMore: boolean;
}

// ── Sort ──

export interface SortOption {
  label: string;
  value: string;
}

// ── Filters ──

export interface LibraryFilters {
  genre?: string;
  year?: string;
  contentRating?: string;
  unwatched?: boolean;
  /** Used to send the correct unwatched param to the Plex API */
  sectionType?: "movie" | "show" | "artist" | "photo";
}

export interface FilterOption {
  key: string;
  title: string;
}
