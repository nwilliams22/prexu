/**
 * Player-chrome E2E specs (prexu-ceiz, spike prexu-pd1x.12).
 *
 * Runs ONLY under the "player-chrome" Playwright project (see
 * playwright.config.ts), whose dedicated Vite server starts in the
 * "player-chrome-test" mode (see vite.config.ts). That mode aliases
 * src/hooks/usePlayer.ts to src/hooks/usePlayer.playwright-stub.ts — a
 * scriptable, in-memory stand-in for the playback engine (no network, no
 * hls.js, no real <video> source) — so these specs drive the REAL player
 * chrome (src/components/player/: ControlsBottomBar, ControlsOverflowMenu,
 * SeekBar, ErrorOverlay, KeyboardShortcutsOverlay) on /play/<ratingKey> in
 * an actual browser, with no native player and no real Plex stream.
 *
 * Same auth-path realism as the default projects: window.__TAURI_INTERNALS__
 * is NEVER set (see e2e/mock-tauri.ts's docblock on the 48-fake-pass trap).
 * The only thing swapped is the playback-engine hook; routing, auth guards,
 * and the AppLayout/Dashboard chrome underneath the player overlay are all
 * the genuine app code, exercised the same way the other e2e specs do.
 *
 * The Dashboard mounts underneath the full-viewport player overlay (same as
 * production — PlayBridge hands off to "/" and PlayerOverlay sits outside
 * the route tree) and its poster cards render their OWN "Play" buttons in
 * the DOM, just visually covered. Role-based locators don't know about
 * z-index, so every player-chrome query below is scoped through
 * playerRoot() (Player.tsx's outer container, identified by its
 * `data-render-tick` attribute — see that file's prexu-0p3 comment) to
 * avoid matching the Dashboard's own controls.
 *
 * Covered here: play/pause toggle, seek-bar scrubbing, the responsive
 * overflow "more controls" menu, keyboard shortcuts (Space, "?"), and the
 * error overlay (forced via the stub's test harness).
 *
 * Deliberately NOT covered (documented, not silently skipped):
 *   - MiniChrome / in-window minimize: gated on SUPPORTS_PLAYER_MINIMIZE,
 *     which requires IS_NATIVE_PLAYER_PLATFORM (Tauri + Windows/Linux) —
 *     unreachable here by construction since this project must never set
 *     window.__TAURI_INTERNALS__ (see engineResolution.ts). Native-only;
 *     out of scope per the tauri-driver NO-GO decision (prexu-g8a.5).
 *   - PostPlayScreen / queue UI: requires a populated playback queue, which
 *     the stub deliberately does not fabricate (queue population is a
 *     separate, itemType==="episode"-gated concern in
 *     useQueueAutoPopulate/useEpisodeNavigation, unrelated to the playback-
 *     engine seam this stub swaps).
 */

import { test, expect, type Page, type Locator } from "@playwright/test";
import { tauriStubScript } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";
// Type-only import — erased before compilation, so this does NOT pull the
// stub module (or its mode-guard throw) into the test file at runtime. See
// src/hooks/usePlayer.playwright-stub.ts for the harness implementation.
import type { PlayerChromeStubHarness } from "../src/hooks/usePlayer.playwright-stub";

declare global {
  interface Window {
    __playerChromeStub__?: PlayerChromeStubHarness;
  }
}

/** Player.tsx's outer container — see docblock above for why locators are
 *  scoped through this rather than querying the whole page. */
function playerRoot(page: Page): Locator {
  return page.locator("[data-render-tick]");
}

/** Navigate to the /play/ bridge route and wait for the stub engine's test
 *  harness to register — a reliable signal that usePlayer (the stub) has
 *  mounted and the chrome tree underneath it has committed at least once. */
async function gotoPlayer(page: Page, ratingKey = "100") {
  await page.goto(`/play/${ratingKey}`);
  await page.waitForFunction(() => Boolean(window.__playerChromeStub__));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

test.describe("Player chrome — play/pause", () => {
  test("toggles play/pause via the transport button and reflects state", async ({ page }) => {
    await gotoPlayer(page);

    // exact: true — "Play" would otherwise substring-match the inline
    // "Playback queue" button's accessible name at full-width viewports.
    const toggleButton = playerRoot(page).getByRole("button", { name: "Play", exact: true });
    await expect(toggleButton).toBeVisible();

    let state = await page.evaluate(() => window.__playerChromeStub__!.getState());
    expect(state.isPlaying).toBe(false);

    await toggleButton.click();
    await expect(playerRoot(page).getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    state = await page.evaluate(() => window.__playerChromeStub__!.getState());
    expect(state.isPlaying).toBe(true);

    await playerRoot(page).getByRole("button", { name: "Pause", exact: true }).click();
    await expect(playerRoot(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();
    state = await page.evaluate(() => window.__playerChromeStub__!.getState());
    expect(state.isPlaying).toBe(false);
  });
});

test.describe("Player chrome — seek", () => {
  test("scrubbing the seek bar moves the playhead", async ({ page }) => {
    await gotoPlayer(page);

    const seekBar = playerRoot(page).getByRole("slider", { name: "Seek" });
    await expect(seekBar).toBeVisible();
    await expect(seekBar).toHaveAttribute("aria-valuenow", "0");

    const box = await seekBar.boundingBox();
    if (!box) throw new Error("seek bar has no bounding box");
    // Click at ~50% of the bar's width — getSeekTime maps this linearly to
    // ~duration/2 (fixture duration is 600s, see the stub).
    await seekBar.click({ position: { x: box.width / 2, y: box.height / 2 } });

    await expect
      .poll(async () => {
        const state = await page.evaluate(() => window.__playerChromeStub__!.getState());
        return state.currentTime;
      })
      .toBeGreaterThan(200);

    const valueNow = await seekBar.getAttribute("aria-valuenow");
    expect(Number(valueNow)).toBeGreaterThan(200);
  });
});

test.describe("Player chrome — keyboard shortcuts", () => {
  test("Space toggles play/pause", async ({ page }) => {
    await gotoPlayer(page);

    await expect(playerRoot(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(playerRoot(page).getByRole("button", { name: "Pause", exact: true })).toBeVisible();

    await page.keyboard.press("Space");
    await expect(playerRoot(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();
  });

  test("? opens the keyboard shortcuts overlay", async ({ page }) => {
    await gotoPlayer(page);

    await expect(page.getByRole("heading", { name: "Keyboard Shortcuts" })).toBeHidden();
    await page.keyboard.press("?");
    await expect(page.getByRole("heading", { name: "Keyboard Shortcuts" })).toBeVisible();
    await expect(page.getByText("Play / Pause")).toBeVisible();

    // Close via the modal's own close button rather than re-pressing "?" —
    // the overlay's backdrop captures the click; ESC would also exit
    // fullscreen/back out of the player, which isn't what's under test here.
    await page.getByRole("button", { name: "✕" }).click();
    await expect(page.getByRole("heading", { name: "Keyboard Shortcuts" })).toBeHidden();
  });
});

test.describe("Player chrome — overflow menu", () => {
  // Narrow viewport so ControlsBottomBar's own ResizeObserver measures the
  // row under CONTROLS_BREAKPOINTS.rightOverflow (560px, see
  // controlsCompaction.ts) and collapses the secondary buttons into the
  // "more controls" menu. Set at context-creation time (not via a runtime
  // resize) so Player.tsx's resize-hides-chrome affordance never engages.
  test.use({ viewport: { width: 500, height: 800 } });

  test("opens and renders collapsed items", async ({ page }) => {
    await gotoPlayer(page);

    const moreButton = playerRoot(page).getByRole("button", { name: "More controls" });
    await expect(moreButton).toBeVisible();
    await moreButton.click();

    const menu = page.getByRole("menu", { name: "More controls" });
    await expect(menu).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Audio" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Playback queue" })).toBeVisible();
  });
});

test.describe("Player chrome — error overlay", () => {
  test("renders when the stub reports a playback error, and Retry clears it", async ({ page }) => {
    await gotoPlayer(page);

    await expect(playerRoot(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();

    await page.evaluate(() => {
      window.__playerChromeStub__!.setError("Simulated playback error (player-chrome harness)");
    });

    await expect(page.getByText("Simulated playback error (player-chrome harness)")).toBeVisible();
    // exact: true — scoped to playerRoot since the app has an unrelated,
    // generic BackButton component (aria-label "Go back") reachable
    // elsewhere in the mounted tree; ErrorOverlay's own button text is
    // "Go Back" (capital B), which otherwise collides case-insensitively.
    await expect(playerRoot(page).getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(playerRoot(page).getByRole("button", { name: "Go Back", exact: true })).toBeVisible();
    // Controls are suppressed while an error is showing (Player.tsx gates
    // PlayerControls on `!player.playbackError`).
    await expect(playerRoot(page).getByRole("button", { name: "Play", exact: true })).toBeHidden();

    await playerRoot(page).getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText("Simulated playback error (player-chrome harness)")).toBeHidden();
    await expect(playerRoot(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();
  });
});
