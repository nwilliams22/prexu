# Prexu Roadmap

## Completed

- [x] Core app shell (auth, server select, sidebar, routing)
- [x] Dashboard (On Deck, Recently Added Movies/Shows)
- [x] Library grid with sorting and context menus
- [x] Item detail with seasons/episodes
- [x] Global search
- [x] Video player (direct play + HLS transcode)
- [x] Audio/subtitle track selection
- [x] Watch Together (relay sync, invites, participant overlay)
- [x] Settings page (playback, appearance, relay config)
- [x] Loading/error/empty states
- [x] Animations & transitions
- [x] Visual consistency pass
- [x] Library filtering (genre, year, rating, unwatched) with filter chips UI
- [x] Persistent filter/sort preferences via URL params
- [x] Watch History page with infinite scroll and virtualized grid
- [x] Collections browsing and detail pages
- [x] Playlists browsing and detail pages
- [x] Related items, extras/trailers, and chapter markers on ItemDetail
- [x] User profiles & multi-user switching with PIN support and avatars
- [x] Code splitting (all routes lazy-loaded via React.lazy + Suspense)
- [x] Image lazy loading via IntersectionObserver
- [x] In-memory TTL cache with localStorage persistence and SWR pattern
- [x] Library section prefetching on auth
- [x] Virtualized library grid (@tanstack/react-virtual)
- [x] Memoized PosterCard and render optimizations
- [x] Unit tests (services, hooks, utilities — 97 test files)
- [x] Component tests (PosterCard, FilterBar, modals, forms)
- [x] E2E tests (auth, navigation, watch history, playlists, performance)
- [x] Responsive design (mobile bottom nav, tablet hamburger menu, breakpoint system)
- [x] Accessibility (ARIA attributes, keyboard nav, focus traps, reduced motion, route announcer)

---

## Up Next

### Remaining Gaps

Small items left over from earlier phases:

- [x] Play all / shuffle buttons for playlists and collections
- [ ] Reviews/ratings display on ItemDetail (from Plex metadata)
- [ ] Progressive image loading (blur-up placeholder → full image)
- [ ] srcSet for different poster sizes

---

### Auto-Update System

Plex-style seamless updates — app checks for updates on launch, downloads in background, and relaunches.

**Done:**
- [x] `useAutoUpdate` hook checks for updates on launch
- [x] `UpdateNotification` component shows update banner in sidebar
- [x] Version display in Settings page

**Remaining:**
- [ ] Install and configure `tauri-plugin-updater` in Cargo.toml
- [ ] Generate signing keys (`tauri signer generate`)
- [ ] Configure `tauri.conf.json` with updater endpoint + pubkey
- [ ] Update splash screen with progress bar during install
- [ ] CI pipeline: build → sign → publish to GitHub Releases
- [ ] Update manifest hosted at GitHub Releases
- [ ] "Update available" badge on Settings nav item

---

## ~~Phase A: Player & Playback Enhancements~~ ✅ Completed

### Skip Intro / Skip Credits
- [x] Detect and use Plex intro/credits markers
- [x] "Skip Intro" overlay button (Netflix-style) during detected intro segments
- [x] "Skip Credits" / "Next Episode" prompt at credits
- [x] Fall back to chapter-based detection if markers unavailable
- [x] Configurable in Settings (skip intro / skip credits toggles)

### Up Next Queue
- [x] Playback queue showing upcoming items (next episodes, playlist items)
- [x] Reorder and add/remove items from queue
- [x] Mini queue panel accessible from player controls
- [x] Auto-populate queue for sequential TV episodes
- [x] Post-play screen with countdown timer and auto-play toggle

### Subtitle Styling
- [x] Font selection for subtitles
- [x] Text color and background color/opacity
- [x] Outline/shadow options
- [x] Preview of subtitle style in settings
- [x] Applied via ::cue CSS in player

### Subtitle Search & Download
- [x] Search external subtitle providers (OpenSubtitles) via Plex server API
- [x] Filter by language, hearing impaired, and match confidence
- [x] Download and apply subtitles to the current playback session
- [x] Upload downloaded subs to Plex server for future use
- [x] Search/filter through available embedded tracks when a file has many subtitle streams

### 4K / HDR Badges
- [x] Resolution badges (720p, 1080p, 4K) on poster cards and detail pages
- [x] HDR / Dolby Vision / Atmos indicators
- [x] Bitrate and codec info on detail page media info section

---

## ~~Phase B: Search & Discovery~~ ✅ Completed

### Search Autocomplete
- [x] Live suggestions as-you-type (debounced against Plex hub search)
- [x] Recent searches dropdown
- [x] Highlight matching text in suggestions
- [x] Keyboard navigation through suggestion list (arrow keys + enter)

### New on Server Alerts
- [x] Track newly added content since last app launch
- [x] "New" badge on library sections with new content
- [x] Optional "What's New" summary on dashboard
- [x] Dismissible per-item or bulk dismiss

---

## ~~Phase C: Playlist & Library Management~~ ✅ Completed

### Playlist Management
- [x] Create new playlists from UI
- [x] Add items to playlist via context menu and detail page
- [x] Remove items and reorder playlist contents
- [x] Edit playlist title and description
- [x] Delete playlists

### Play All / Shuffle
- [x] Play all button on playlist and collection detail pages
- [x] Shuffle mode for playlists and collections
- [x] Shuffle indicator in player UI

---

## ~~Phase D: Polish & UX~~ ✅ Completed

### Toast Notification System
- [x] Generic toast component for transient feedback
- [x] Success/error/info variants with auto-dismiss
- [x] Use for: "Added to playlist", "Marked as watched", copy confirmations, errors
- [x] Stack multiple toasts, dismiss on click

### Parental Controls
- [x] Per-profile content rating restrictions (G, PG, PG-13, R, etc.)
- [x] Content rating filter enforcement in library browsing and search
- [x] Settings UI to configure restrictions per managed user
- [x] Locked profiles require PIN to change restrictions

---

## Future: Non-Video Media

Items deferred until core video streaming is fully polished.

### Music Player
- Dedicated music player UI with mini player
- Album art display and track listing
- Music library browsing (artists, albums, tracks, genres)
- Background playback while browsing

### Photo / Gallery Viewer
- Lightbox-style photo viewer
- Photo library and album browsing
- Slideshow mode
- EXIF data display

---

## Future Ideas

Items not yet planned or scoped — add here as they come up.

- Light theme option (foundation exists via `prefers-color-scheme` support)
- Swipe gestures on horizontal rows (mobile)
- Pull-to-refresh on dashboard (mobile)
- About dialog with version info
- Download for offline viewing (Tauri filesystem access)
