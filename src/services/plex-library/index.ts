/**
 * Plex library API functions — barrel re-export.
 *
 * All consumers import from "services/plex-library" which resolves here.
 * Internal modules are organized by domain:
 *   - base.ts        — fetchJson helper, getLibrarySections
 *   - items.ts       — getRecentlyAdded, getRecentlyAddedBySection, getOnDeck
 *   - filter.ts      — getLibraryItems, getFilterOptions
 *   - detail.ts      — getItemMetadata, getItemChildren
 *   - episodes.ts    — getNextEpisode, getPreviousEpisode
 *   - history.ts     — getWatchHistory
 *   - collections.ts — getCollections, getCollectionItems
 *   - playlists.ts   — getPlaylists, getPlaylistItems, addToPlaylist, createPlaylist, deletePlaylist, removeFromPlaylist, movePlaylistItem, updatePlaylist
 *   - related.ts     — getRelatedItems, getExtras, getMediaByActor, searchLibrary
 *   - watch-state.ts — markAsWatched, markAsUnwatched
 *   - admin.ts       — scanLibrary, refreshLibraryMetadata, emptyLibraryTrash
 *   - images.ts      — getImageUrl
 */

export { getLibrarySections } from "./base";
export {
  getLibraryItems,
  getRecentlyAdded,
  getRecentlyAddedBySection,
  getOnDeck,
} from "./items";
export { getFilterOptions } from "./filter";
export { getItemMetadata, getItemChildren } from "./detail";
export { getNextEpisode, getPreviousEpisode } from "./episodes";
export { getWatchHistory } from "./history";
export { getCollections, getCollectionItems } from "./collections";
export {
  getPlaylists,
  getPlaylistItems,
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  removeFromPlaylist,
  movePlaylistItem,
  updatePlaylist,
} from "./playlists";
export {
  getRelatedItems,
  getExtras,
  getMediaByActor,
  searchLibrary,
} from "./related";
export { markAsWatched, markAsUnwatched } from "./watch-state";
export {
  scanLibrary,
  refreshLibraryMetadata,
  emptyLibraryTrash,
} from "./admin";
export { getImageUrl, getPlaceholderUrl, getImageSrcSet } from "./images";
