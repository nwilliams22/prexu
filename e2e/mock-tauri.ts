/**
 * Tauri API stubs for Playwright E2E tests.
 *
 * Inject this via page.addInitScript() before navigating.
 * It stubs the Tauri runtime APIs so the React app can render
 * outside the Tauri WebView2 container.
 */

export const tauriStubScript = `
  // Prevent Tauri runtime errors
  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {
    invoke: () => Promise.resolve(null),
    transformCallback: () => 0,
  };

  // Stub @tauri-apps/plugin-shell open()
  window.__TAURI_PLUGIN_SHELL__ = {
    open: () => Promise.resolve(),
  };

  // Stub @tauri-apps/plugin-log
  window.__TAURI_PLUGIN_LOG__ = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
`;

/**
 * Mock Plex API responses for E2E tests.
 * Use page.route() to intercept API calls.
 */
export const mockPlexData = {
  sections: {
    MediaContainer: {
      size: 2,
      Directory: [
        {
          key: "1",
          title: "Movies",
          type: "movie",
          agent: "tv.plex.agents.movie",
          scanner: "Plex Movie",
          thumb: "/library/sections/1/thumb",
          art: "/library/sections/1/art",
          updatedAt: 1700000000,
        },
        {
          key: "2",
          title: "TV Shows",
          type: "show",
          agent: "tv.plex.agents.series",
          scanner: "Plex TV Series",
          thumb: "/library/sections/2/thumb",
          art: "/library/sections/2/art",
          updatedAt: 1700000000,
        },
      ],
    },
  },

  libraryItems: {
    MediaContainer: {
      size: 3,
      totalSize: 3,
      Metadata: [
        {
          ratingKey: "100",
          key: "/library/metadata/100",
          type: "movie",
          title: "Test Movie 1",
          titleSort: "Test Movie 1",
          year: 2024,
          thumb: "/library/metadata/100/thumb",
          art: "/library/metadata/100/art",
          addedAt: 1700000000,
          updatedAt: 1700000000,
          summary: "A thrilling test movie about testing.",
          duration: 7200000,
          contentRating: "PG-13",
          viewCount: 0,
          Genre: [{ tag: "Action" }, { tag: "Drama" }],
        },
        {
          ratingKey: "101",
          key: "/library/metadata/101",
          type: "movie",
          title: "Test Movie 2",
          titleSort: "Test Movie 2",
          year: 2023,
          thumb: "/library/metadata/101/thumb",
          art: "/library/metadata/101/art",
          addedAt: 1700000001,
          updatedAt: 1700000001,
          viewCount: 1,
        },
        {
          ratingKey: "102",
          key: "/library/metadata/102",
          type: "movie",
          title: "Test Movie 3",
          titleSort: "Test Movie 3",
          year: 2022,
          thumb: "/library/metadata/102/thumb",
          art: "/library/metadata/102/art",
          addedAt: 1700000002,
          updatedAt: 1700000002,
          viewCount: 0,
        },
      ],
    },
  },

  tvShowItems: {
    MediaContainer: {
      size: 2,
      totalSize: 2,
      Metadata: [
        {
          ratingKey: "200",
          key: "/library/metadata/200",
          type: "show",
          title: "Test Show 1",
          titleSort: "Test Show 1",
          year: 2024,
          thumb: "/library/metadata/200/thumb",
          art: "/library/metadata/200/art",
          addedAt: 1700000000,
          updatedAt: 1700000000,
          leafCount: 20,
          viewedLeafCount: 10,
          childCount: 2,
        },
        {
          ratingKey: "201",
          key: "/library/metadata/201",
          type: "show",
          title: "Test Show 2",
          titleSort: "Test Show 2",
          year: 2023,
          thumb: "/library/metadata/201/thumb",
          art: "/library/metadata/201/art",
          addedAt: 1700000001,
          updatedAt: 1700000001,
          leafCount: 12,
          viewedLeafCount: 12,
          childCount: 1,
        },
      ],
    },
  },

  movieDetail: {
    MediaContainer: {
      size: 1,
      Metadata: [
        {
          ratingKey: "100",
          key: "/library/metadata/100",
          type: "movie",
          title: "Test Movie 1",
          year: 2024,
          thumb: "/library/metadata/100/thumb",
          art: "/library/metadata/100/art",
          summary: "A thrilling test movie about testing.",
          duration: 7200000,
          rating: 8.5,
          audienceRating: 9.0,
          contentRating: "PG-13",
          viewCount: 0,
          viewOffset: 1800000,
          Genre: [{ tag: "Action" }, { tag: "Drama" }],
          Director: [{ tag: "John Director" }],
          Role: [
            { tag: "Actor One", thumb: "/actor/1", role: "Hero" },
            { tag: "Actor Two", thumb: "/actor/2", role: "Villain" },
          ],
          Media: [
            {
              id: 1,
              duration: 7200000,
              bitrate: 10000,
              videoResolution: "1080",
              videoCodec: "h264",
              audioCodec: "aac",
              Part: [{ id: 1, key: "/library/parts/1", duration: 7200000 }],
            },
          ],
        },
      ],
    },
  },

  showDetail: {
    MediaContainer: {
      size: 1,
      Metadata: [
        {
          ratingKey: "200",
          key: "/library/metadata/200",
          type: "show",
          title: "Test Show 1",
          year: 2024,
          thumb: "/library/metadata/200/thumb",
          art: "/library/metadata/200/art",
          summary: "A dramatic TV show for testing.",
          leafCount: 20,
          viewedLeafCount: 10,
          childCount: 2,
          Genre: [{ tag: "Drama" }, { tag: "Thriller" }],
          Role: [{ tag: "Lead Actor", thumb: "/actor/3", role: "Protagonist" }],
        },
      ],
    },
  },

  seasons: {
    MediaContainer: {
      size: 2,
      Metadata: [
        {
          ratingKey: "210",
          key: "/library/metadata/210/children",
          type: "season",
          title: "Season 1",
          index: 1,
          parentRatingKey: "200",
          parentTitle: "Test Show 1",
          thumb: "/library/metadata/210/thumb",
          leafCount: 10,
          viewedLeafCount: 10,
        },
        {
          ratingKey: "211",
          key: "/library/metadata/211/children",
          type: "season",
          title: "Season 2",
          index: 2,
          parentRatingKey: "200",
          parentTitle: "Test Show 1",
          thumb: "/library/metadata/211/thumb",
          leafCount: 10,
          viewedLeafCount: 0,
        },
      ],
    },
  },

  onDeck: {
    MediaContainer: {
      size: 0,
      Metadata: [],
    },
  },

  onDeckWithItems: {
    MediaContainer: {
      size: 2,
      Metadata: [
        {
          ratingKey: "220",
          key: "/library/metadata/220",
          type: "episode",
          title: "Pilot",
          index: 1,
          parentIndex: 1,
          parentTitle: "Season 1",
          grandparentTitle: "Test Show 1",
          grandparentRatingKey: "200",
          grandparentThumb: "/library/metadata/200/thumb",
          grandparentArt: "/library/metadata/200/art",
          thumb: "/library/metadata/220/thumb",
          duration: 3600000,
          viewOffset: 1200000,
          summary: "The pilot episode.",
        },
        {
          ratingKey: "100",
          key: "/library/metadata/100",
          type: "movie",
          title: "Test Movie 1",
          year: 2024,
          thumb: "/library/metadata/100/thumb",
          art: "/library/metadata/100/art",
          duration: 7200000,
          viewOffset: 3600000,
          summary: "A thrilling test movie.",
        },
      ],
    },
  },

  recentlyAdded: {
    MediaContainer: {
      size: 0,
      Metadata: [],
    },
  },

  recentlyAddedWithItems: {
    MediaContainer: {
      size: 3,
      Metadata: [
        {
          ratingKey: "102",
          key: "/library/metadata/102",
          type: "movie",
          title: "Test Movie 3",
          year: 2022,
          thumb: "/library/metadata/102/thumb",
          art: "/library/metadata/102/art",
          addedAt: 1700000002,
          viewCount: 0,
        },
        {
          ratingKey: "101",
          key: "/library/metadata/101",
          type: "movie",
          title: "Test Movie 2",
          year: 2023,
          thumb: "/library/metadata/101/thumb",
          art: "/library/metadata/101/art",
          addedAt: 1700000001,
          viewCount: 1,
        },
        {
          ratingKey: "100",
          key: "/library/metadata/100",
          type: "movie",
          title: "Test Movie 1",
          year: 2024,
          thumb: "/library/metadata/100/thumb",
          art: "/library/metadata/100/art",
          addedAt: 1700000000,
          viewCount: 0,
          rating: 9.2,
        },
      ],
    },
  },

  searchResults: {
    MediaContainer: {
      size: 2,
      Hub: [
        {
          hubIdentifier: "movie",
          type: "movie",
          title: "Movies",
          size: 2,
          Metadata: [
            {
              ratingKey: "100",
              key: "/library/metadata/100",
              type: "movie",
              title: "Test Movie 1",
              year: 2024,
              thumb: "/library/metadata/100/thumb",
            },
            {
              ratingKey: "101",
              key: "/library/metadata/101",
              type: "movie",
              title: "Test Movie 2",
              year: 2023,
              thumb: "/library/metadata/101/thumb",
            },
          ],
        },
        {
          hubIdentifier: "show",
          type: "show",
          title: "TV Shows",
          size: 1,
          Metadata: [
            {
              ratingKey: "200",
              key: "/library/metadata/200",
              type: "show",
              title: "Test Show 1",
              year: 2024,
              thumb: "/library/metadata/200/thumb",
            },
          ],
        },
      ],
    },
  },

  playlists: {
    MediaContainer: {
      size: 2,
      Metadata: [
        {
          ratingKey: "300",
          key: "/playlists/300/items",
          type: "playlist",
          title: "My Favorites",
          composite: "/playlists/300/composite",
          thumb: "/playlists/300/thumb",
          leafCount: 12,
          smart: false,
          playlistType: "video",
          addedAt: 1700000000,
        },
        {
          ratingKey: "301",
          key: "/playlists/301/items",
          type: "playlist",
          title: "Weekend Binge",
          composite: "/playlists/301/composite",
          thumb: "/playlists/301/thumb",
          leafCount: 5,
          smart: false,
          playlistType: "video",
          addedAt: 1700000001,
        },
      ],
    },
  },

  collections: {
    MediaContainer: {
      size: 3,
      Metadata: [
        {
          ratingKey: "400",
          key: "/library/collections/400/children",
          type: "collection",
          title: "Marvel Collection",
          thumb: "/library/collections/400/thumb",
          childCount: 25,
          addedAt: 1700000000,
          subtype: "movie",
        },
        {
          ratingKey: "401",
          key: "/library/collections/401/children",
          type: "collection",
          title: "DC Collection",
          thumb: "/library/collections/401/thumb",
          childCount: 12,
          addedAt: 1700000001,
          subtype: "movie",
        },
        {
          ratingKey: "402",
          key: "/library/collections/402/children",
          type: "collection",
          title: "Horror Classics",
          thumb: "/library/collections/402/thumb",
          childCount: 8,
          addedAt: 1700000002,
          subtype: "movie",
        },
      ],
    },
  },

  watchHistory: {
    MediaContainer: {
      size: 4,
      totalSize: 4,
      Metadata: [
        {
          ratingKey: "100",
          key: "/library/metadata/100",
          type: "movie",
          title: "Test Movie 1",
          year: 2024,
          thumb: "/library/metadata/100/thumb",
          viewCount: 2,
          lastViewedAt: 1700100000,
        },
        {
          ratingKey: "220",
          key: "/library/metadata/220",
          type: "episode",
          title: "Pilot",
          index: 1,
          parentIndex: 1,
          parentTitle: "Season 1",
          grandparentTitle: "Test Show 1",
          grandparentRatingKey: "200",
          thumb: "/library/metadata/220/thumb",
          viewCount: 1,
          lastViewedAt: 1700090000,
        },
        {
          ratingKey: "101",
          key: "/library/metadata/101",
          type: "movie",
          title: "Test Movie 2",
          year: 2023,
          thumb: "/library/metadata/101/thumb",
          viewCount: 1,
          lastViewedAt: 1700080000,
        },
        {
          ratingKey: "221",
          key: "/library/metadata/221",
          type: "episode",
          title: "Second Episode",
          index: 2,
          parentIndex: 1,
          parentTitle: "Season 1",
          grandparentTitle: "Test Show 1",
          grandparentRatingKey: "200",
          thumb: "/library/metadata/221/thumb",
          viewCount: 1,
          lastViewedAt: 1700070000,
        },
      ],
    },
  },

  emptyLibrary: {
    MediaContainer: {
      size: 0,
      totalSize: 0,
      Metadata: [],
    },
  },

  emptySearch: {
    MediaContainer: {
      size: 0,
      Hub: [],
    },
  },
};
