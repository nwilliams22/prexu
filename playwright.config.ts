import { defineConfig } from "@playwright/test";

// Dedicated port for the player-chrome project's Vite server, run under the
// "player-chrome-test" mode (see vite.config.ts) so the playback-engine hook
// is swapped for a scriptable stub. Distinct from the default dev server's
// port 1420 so both can be started side-by-side without a port clash — see
// the webServer array below (prexu-ceiz, spike prexu-pd1x.12).
const PLAYER_CHROME_TEST_PORT = 4301;

// Matches only the new player-chrome spec — the default chromium/webkit
// projects must never attempt it (it depends on the player-chrome-test
// server + the window.__playerChromeStub__ harness, neither of which exist
// under the default dev server), and the player-chrome project must never
// run the rest of the suite (it depends on API mocks / real routing that
// the dedicated server isn't set up to serve identically).
const PLAYER_CHROME_SPEC = /player-chrome\.spec\.ts$/;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
      testIgnore: PLAYER_CHROME_SPEC,
    },
    {
      name: "webkit",
      use: { browserName: "webkit" },
      testIgnore: PLAYER_CHROME_SPEC,
    },
    // Playwright player-mode Vite-alias chrome shim (prexu-ceiz): drives the
    // real player chrome (src/components/player/) on /play/<ratingKey>
    // against the "player-chrome-test" Vite mode, which aliases
    // src/hooks/usePlayer.ts to a scriptable no-op stub — no native player,
    // no real Plex stream. NEVER sets window.__TAURI_INTERNALS__ (same
    // auth-path realism as the default projects — see e2e/mock-tauri.ts).
    {
      name: "player-chrome",
      use: { browserName: "chromium", baseURL: `http://localhost:${PLAYER_CHROME_TEST_PORT}` },
      testMatch: PLAYER_CHROME_SPEC,
    },
  ],
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:1420",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: `npx vite --mode player-chrome-test --port ${PLAYER_CHROME_TEST_PORT} --strictPort`,
      url: `http://localhost:${PLAYER_CHROME_TEST_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
});
