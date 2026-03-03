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

---

## Phase 1: New Features

### 1.1 Library Filtering & Advanced Sort
- Filter by genre, year, rating, resolution, unwatched
- Multi-column sort (e.g. title + year)
- Persistent filter/sort preferences per library section
- Filter chips UI below the sort bar

### 1.2 Watch History
- Dedicated "Watch History" page showing recently watched items with timestamps
- Pull from Plex `/status/sessions/history/all` endpoint
- Infinite scroll or pagination
- Quick resume button per item

### 1.3 Collections & Playlists
- Browse Plex collections within each library
- View collection detail (items, description, poster)
- Browse user playlists
- Play all / shuffle playlist

### 1.4 Pre-play Screen Enhancements
- Related/similar items row on ItemDetail
- Extras (trailers, behind the scenes) if available
- Reviews/ratings from Plex metadata
- Chapter markers display for movies

### 1.5 User Profiles & Multi-user
- Switch between managed users on the same Plex account
- Per-user watch state and preferences
- Profile avatar in header

---

## Phase 2: Performance

### 2.1 Code Splitting
- Lazy-load routes with `React.lazy()` + `Suspense`
- Split Player (largest component) into its own chunk
- Target: main bundle under 500KB

### 2.2 Image Optimization
- Intersection Observer for lazy-loading poster images
- Progressive image loading (blur-up placeholder → full image)
- Proper srcSet for different poster sizes
- Cache poster URLs in memory

### 2.3 Data Caching & Prefetching
- In-memory cache for library metadata and section data
- Prefetch adjacent pages in LibraryView
- Prefetch item detail on poster hover
- Stale-while-revalidate pattern for dashboard data

### 2.4 Render Optimization
- Virtualized lists for large libraries (react-window or similar)
- Memoize PosterCard and episode rows
- Debounce resize observers
- Profile and fix unnecessary re-renders

---

## Phase 3: Testing

### 3.1 Unit Tests
- Service layer tests (plex-api, plex-library, plex-playback)
- Hook tests (useAuth, useLibrary, usePreferences)
- Utility function tests

### 3.2 Component Tests
- PosterCard, HorizontalRow, Sidebar render tests
- Modal/overlay interaction tests
- Form input tests (Settings, SearchBar)

### 3.3 Integration Tests
- Auth flow (login → server select → dashboard)
- Navigation and routing
- Player playback lifecycle
- Watch Together session flow

---

## Phase 4: Responsive Design

### 4.1 Tablet Layout (768px–1024px)
- Collapsible sidebar → hamburger menu
- Responsive poster grid (fewer columns)
- Touch-friendly hit targets (min 44px)
- Swipe gestures on horizontal rows

### 4.2 Mobile Layout (<768px)
- Bottom tab navigation replacing sidebar
- Full-width poster cards
- Stacked item detail layout
- Mobile-optimized player controls
- Pull-to-refresh on dashboard

### 4.3 Large Screen (>1440px)
- Max-width container for content
- Larger poster sizes
- More columns in library grid

---

## Phase 5: Accessibility

### 5.1 Keyboard Navigation
- Tab order through all interactive elements
- Arrow key navigation in poster grids and horizontal rows
- Escape to close modals/menus
- Enter/Space to activate buttons
- Focus trap in modals

### 5.2 Screen Reader Support
- ARIA labels on all icon-only buttons
- ARIA live regions for loading/error states
- Role attributes on custom widgets
- Announce route changes

### 5.3 Visual Accessibility
- Focus ring styles (visible focus indicators)
- Sufficient color contrast ratios (WCAG AA)
- Respect `prefers-reduced-motion`
- Respect `prefers-color-scheme` (light theme option)
