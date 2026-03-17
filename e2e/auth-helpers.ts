/**
 * E2E helper: seed localStorage with auth + server data
 * so the app boots into authenticated state.
 */

import type { Page } from "@playwright/test";
import { mockPlexData } from "./mock-tauri";

export const seedAuthScript = `
  // Auth data — simulates a logged-in Plex user
  localStorage.setItem('auth_data', JSON.stringify({
    authToken: "test-token-abc123",
    clientIdentifier: "test-client-id-e2e",
  }));

  // Server data — simulates a selected Plex server
  localStorage.setItem('server_data', JSON.stringify({
    name: "Test Server",
    uri: "http://localhost:32400",
    accessToken: "server-token-xyz",
    machineIdentifier: "machine-id-123",
    owned: true,
  }));

  // Active user — simulates the admin user
  localStorage.setItem('active_user', JSON.stringify({
    id: 1,
    title: "TestUser",
    thumb: "/avatars/test.png",
    isAdmin: true,
    token: "test-token-abc123",
  }));

  // Client identifier
  localStorage.setItem('client_identifier', JSON.stringify("test-client-id-e2e"));

  // Default preferences
  localStorage.setItem('prexu_preferences', JSON.stringify({
    playback: {
      quality: "1080p",
      preferredAudioLanguage: "",
      preferredSubtitleLanguage: "",
      defaultSubtitles: "auto",
      subtitleSize: 100,
      audioBoost: 100,
      directPlayPreference: "auto",
      volumeBoost: 1.0,
      normalizationPreset: "off",
      audioOffsetMs: 0,
    },
    appearance: {
      posterSize: "medium",
      sidebarCollapsed: false,
      dashboardSections: {
        continueWatching: true,
        recentMovies: true,
        recentShows: true,
      },
      skipSingleSeason: true,
    },
  }));
`;

/**
 * Set up authenticated state: seed localStorage + intercept all required API routes.
 * Call this in beforeEach for tests that need an authenticated app.
 */
export async function setupAuthenticatedState(page: Page) {
  await page.addInitScript(seedAuthScript);

  // Intercept Plex.tv token validation — must return 200 for auth to succeed
  await page.route("**/api/v2/user*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        uuid: "test-uuid",
        username: "TestUser",
        email: "test@example.com",
        thumb: "/avatars/test.png",
      }),
    }),
  );

  // Intercept Plex.tv resources endpoint
  await page.route("**/api/v2/resources*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    }),
  );

  // Helper: skip interception for requests to the Vite dev server (app navigation).
  // Only intercept API calls to external servers (Plex, etc.).
  const isAppRequest = (url: string) => url.includes("localhost:1420");

  // IMPORTANT: Playwright routes use LIFO matching (last registered = highest priority).
  // Register catch-all routes FIRST so specific routes registered after take priority.

  // Catch-all for remaining library API calls (filter options, metadata children, etc.)
  // Registered FIRST = lowest priority among library routes.
  await page.route("**/library/**", (route) => {
    if (isAppRequest(route.request().url())) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [], Directory: [] } }),
    });
  });

  // Intercept playlists
  await page.route("**/playlists*", (route) => {
    if (isAppRequest(route.request().url())) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
    });
  });

  // Intercept search
  await page.route("**/hubs/search*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ MediaContainer: { size: 0, Hub: [] } }),
    }),
  );

  // Specific library routes — registered AFTER catch-all = higher priority.
  await page.route("**/library/sections", (route) => {
    if (isAppRequest(route.request().url())) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockPlexData.sections),
    });
  });

  await page.route("**/library/sections/*/all*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockPlexData.libraryItems),
    }),
  );

  await page.route("**/library/onDeck*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockPlexData.onDeck),
    }),
  );

  await page.route("**/library/recentlyAdded*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockPlexData.recentlyAdded),
    }),
  );

  // Intercept /myplex/account (used by getServerAccountId for watch history)
  await page.route("**/myplex/account*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ MyPlex: { id: 1, username: "TestUser" } }),
    }),
  );

  // Intercept /accounts (used by getServerAccountId fallback)
  await page.route("**/accounts*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        MediaContainer: {
          size: 1,
          Account: [{ id: 1, name: "TestUser" }],
        },
      }),
    }),
  );

  // Intercept server root (used by getServerAccountId fallback)
  await page.route("**/localhost:32400/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        MediaContainer: { myPlexUsername: "TestUser" },
      }),
    }),
  );

  // Intercept /status/** endpoints (watch history, sessions, etc.)
  await page.route("**/status/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ MediaContainer: { size: 0, totalSize: 0, Metadata: [] } }),
    }),
  );

  // Stub image/thumbnail requests
  await page.route("**/photo/:/transcode*", (route) => route.abort());
}
