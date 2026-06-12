/**
 * Regression specs for prexu-g8a.3 and prexu-g8a.4.
 *
 * Each test asserts the FIXED behaviour and would fail against the
 * pre-fix code.  Where a behaviour is not web-observable, the test is
 * replaced by a documented rationale comment.
 *
 * Web-build note: IS_NATIVE_PLAYER === false in this suite (the Tauri
 * stub does NOT set window.__TAURI_INTERNALS__), so the HTML5 / HLS.js
 * path is active.  Player chrome (PlayerControls, SkipSegmentButton,
 * MiniChrome) IS rendered by Player.tsx on the web path, but launching
 * a player session via PlayerContext.play() requires navigating to /play/:id
 * or programmatically calling play() through the React tree.  All player-
 * chrome assertions below that depend on an active session are noted
 * with the reason they cannot be exercised as a pure Playwright E2E spec.
 */

import { test, expect } from "@playwright/test";
import { tauriStubScript, mockPlexData } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

// ---------------------------------------------------------------------------
// Shared episode mock data — added to mockPlexData locally for these tests.
// Rating key 220 is the "Pilot" episode in mock-tauri.ts (type:"episode").
// ---------------------------------------------------------------------------
const episodeDetail = {
  MediaContainer: {
    size: 1,
    Metadata: [
      {
        ratingKey: "220",
        key: "/library/metadata/220",
        type: "episode",
        title: "Pilot",
        index: 1,
        parentIndex: 1,
        parentTitle: "Season 1",
        parentRatingKey: "210",
        grandparentTitle: "Test Show 1",
        grandparentRatingKey: "200",
        grandparentThumb: "/library/metadata/200/thumb",
        grandparentArt: "/library/metadata/200/art",
        thumb: "/library/metadata/220/thumb",
        duration: 3600000,
        viewOffset: 0,
        summary: "The pilot episode.",
      },
    ],
  },
};

const seasonEpisodes = {
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
        parentRatingKey: "210",
        grandparentTitle: "Test Show 1",
        grandparentRatingKey: "200",
        grandparentThumb: "/library/metadata/200/thumb",
        duration: 3600000,
      },
      {
        ratingKey: "221",
        key: "/library/metadata/221",
        type: "episode",
        title: "Second Episode",
        index: 2,
        parentIndex: 1,
        parentRatingKey: "210",
        grandparentTitle: "Test Show 1",
        grandparentRatingKey: "200",
        grandparentThumb: "/library/metadata/200/thumb",
        duration: 3600000,
      },
    ],
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

// ---------------------------------------------------------------------------
// FIX 9i0 — /similar is not fetched for episodes
//
// Pre-fix: useItemDetailData always called getRelatedItems, which tried
// /library/metadata/{id}/similar for all item types, returning 404 for
// episodes.  The commit moved the episode-type guard into getRelatedItems
// itself so the HTTP round-trip never happens.
//
// Assertion: navigating to an episode detail page fires NO request
// matching /similar.  A movie page is also tested to confirm the gate
// is type-gated and not globally disabled.
// ---------------------------------------------------------------------------
test.describe("fix 9i0 — /similar not fetched for episodes", () => {
  test("episode detail page fires no /similar request", async ({ page }) => {
    // Register a spy *before* the episode route so LIFO gives the spy lower
    // priority than the catch-all in setupAuthenticatedState.
    const similarRequests: string[] = [];
    await page.route("**/library/metadata/220/similar*", (route) => {
      similarRequests.push(route.request().url());
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
      });
    });

    // Episode metadata — registered after spy so LIFO gives this higher priority
    await page.route("**/library/metadata/220?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(episodeDetail),
      }),
    );
    await page.route("**/library/metadata/220", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(episodeDetail),
      }),
    );
    // Season children (episode list in the same season)
    await page.route("**/library/metadata/210/children*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(seasonEpisodes),
      }),
    );
    // Show metadata for parent
    await page.route("**/library/metadata/200?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.showDetail),
      }),
    );
    await page.route("**/library/metadata/200", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.showDetail),
      }),
    );

    await page.goto("/item/220");
    // Wait for the episode title to appear — confirms useItemDetailData resolved
    await expect(page.getByRole("heading", { name: "Pilot", level: 1 })).toBeVisible();

    // Give any pending async fetches time to settle (networkidle can be
    // unreliable with stubbed routes, a short wait + networkidle is sufficient)
    await page.waitForLoadState("networkidle");

    // The /similar endpoint must NOT have been called for an episode.
    // Pre-fix: getRelatedItems was called unconditionally, firing this request.
    // Post-fix: the episode gate in getRelatedItems returns [] immediately.
    expect(similarRequests).toHaveLength(0);
  });

  test("movie detail page DOES fire a /similar request", async ({ page }) => {
    const similarRequests: string[] = [];

    await page.route("**/library/metadata/100/similar*", (route) => {
      similarRequests.push(route.request().url());
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.similarItems),
      });
    });
    await page.route("**/library/metadata/100/related*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
      }),
    );
    await page.route("**/library/metadata/100/extras*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
      }),
    );
    await page.route("**/library/metadata/100?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.movieDetail),
      }),
    );
    await page.route("**/library/metadata/100", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.movieDetail),
      }),
    );

    await page.goto("/item/100");
    await expect(
      page.getByRole("heading", { name: "Test Movie 1", level: 1 }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Movies still call /similar — confirms the gate is type-selective
    expect(similarRequests.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// FIX jct — cached poster blur-placeholder resolves to sharp
//
// Pre-fix: PosterCard used a useState-based `loaded` flag that was set
// only by the img onLoad event.  When the image was already in the browser
// cache the browser fires the load event synchronously during element
// creation, BEFORE React attaches the onLoad prop — so the flag stayed
// false and the poster remained blurred.
//
// Post-fix: useLazyImage checks img.complete after every render where
// shouldLoad is true and sets isLoaded/hasError directly, bypassing the
// onLoad race.
//
// Web-observable signal: the poster <img> element in a PosterCard starts
// with opacity:0 (blur placeholder visible) and transitions to opacity:1
// once loaded.  We assert that after the page stabilises, the main image
// has opacity:1 (loaded === true).
//
// IntersectionObserver note: Playwright headless does not fire the IO
// callback for elements inside overflow:hidden containers unless the
// element is genuinely in the viewport.  We stub IO globally to call the
// callback immediately on observe() so shouldLoad flips to true and the
// <img> element is rendered.  This mirrors what happens in a real browser
// and still exercises the img.complete fix (the stub does NOT stub
// img.complete itself — that is real browser behaviour on the PNG we serve).
// ---------------------------------------------------------------------------
test.describe("fix jct — poster blur-up resolves to sharp", () => {
  test("poster img transitions to opacity:1 after load (IntersectionObserver-stubbed)", async ({
    page,
  }) => {
    // Stub IntersectionObserver to fire immediately so shouldLoad=true
    // without needing the element to scroll into the real viewport.
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).IntersectionObserver = class {
        callback: IntersectionObserverCallback;
        constructor(cb: IntersectionObserverCallback) {
          this.callback = cb;
        }
        observe(target: Element) {
          // Fire synchronously with isIntersecting=true
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        }
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
      };
    });

    // Serve real poster data so the image can complete
    await page.route("**/library/onDeck*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.onDeckWithItems),
      }),
    );

    // Route ALL image-like requests (thumb, art, photo/:/transcode, etc.) to a
    // valid 1×1 PNG so img.complete and img.naturalWidth > 0 are both true
    // after the browser loads the element.
    const tiny1x1Png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.route("**/library/metadata/**", (route) => {
      const url = route.request().url();
      if (url.includes("/thumb") || url.includes("/art")) {
        return route.fulfill({
          status: 200,
          contentType: "image/png",
          body: tiny1x1Png,
        });
      }
      return route.fallback();
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Continue Watching" }),
    ).toBeVisible();

    // Wait for network to settle so img.complete check has fired
    await page.waitForLoadState("networkidle");

    // Collect all main-image (last <img> in each card, which is the full-res
    // one) opacities. After the fix, once the image loads (complete=true,
    // naturalWidth>0), the effect in useLazyImage sets isLoaded=true which
    // makes PosterCard set opacity:1.
    // Pre-fix: loaded was only set by onLoad; on a cache hit (or when IO
    // fires before React attaches onLoad) it stayed 0 indefinitely.
    const opacities = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".card-enter"));
      return cards.map((card) => {
        const imgs = card.querySelectorAll("img");
        // The last img in the card is the full-resolution one
        const mainImg = imgs[imgs.length - 1] as HTMLImageElement | undefined;
        return mainImg ? mainImg.style.opacity : null;
      });
    });

    // At least one card must have rendered (otherwise the route/IO stubs failed)
    expect(opacities.length).toBeGreaterThanOrEqual(1);
    // Filter out nulls (cards with no img at all)
    const renderedOpacities = opacities.filter((o) => o !== null);
    expect(renderedOpacities.length).toBeGreaterThanOrEqual(1);
    // Every rendered card's main image must have opacity:1 (loaded state)
    // Pre-fix: these would be "0" because the onLoad race was not resolved.
    for (const opacity of renderedOpacities) {
      expect(opacity).toBe("1");
    }
  });
});

// ---------------------------------------------------------------------------
// FIX 6mi — skip pill split: intro / credits / next as separate states
//
// Pre-fix: MiniChrome rendered a single pill that collapsed "Skip Credits +
// has next" into a single "Next Episode" label, hiding "Skip Credits".
// Post-fix: two separate stacked buttons are rendered (skipPillPrimary +
// skipPillNextEpisode) so the user can independently skip credits or advance.
//
// WEB PLAYER CHROME VERDICT (prexu-g8a.4 — see below):
// Player chrome IS rendered by Player.tsx on the IS_NATIVE_PLAYER=false
// path (an HTML5 <video> element + PlayerControls overlay are rendered).
// However, launching a player session requires calling PlayerContext.play()
// which is triggered by clicking a play button inside the React tree that
// then calls usePlayerSession().play().  There is no direct URL route to
// /play/:id that triggers the Player overlay — it is mounted only via
// PlayerContext, which requires clicking through the item-detail play button.
//
// To set up the player overlay in a Playwright test we would need to:
//   1. Navigate to the item-detail page.
//   2. Mock the HLS manifest/segment endpoints.
//   3. Click the play button and wait for Player.tsx to render.
//   4. The HLS loader starts but cannot actually load video chunks
//      (no real stream), so player.isLoading stays true indefinitely
//      and PlayerControls (including SkipSegmentButton) is gated behind
//      !player.isLoading.  The controls never render.
//
// Conclusion: the skip-pill variant logic (6mi) is NOT observable via
// Playwright E2E in the web build because the player chrome is blocked
// by the isLoading guard.  No E2E test is added here — a passing test that
// asserts nothing would be fabricated coverage, not a regression guard.
// The skipPillPrimary / skipPillNextEpisode derivation is covered by unit
// tests in src/components/player/MiniChrome.test.tsx (verified present),
// which render MiniChrome with controlled props and PASS post-fix / FAIL
// pre-fix (pre-fix rendered a single "Next Episode" pill instead of a
// separate "Skip Credits" + next-episode pill).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FIX 0cs — auto-episode queue extends across season boundary
//
// Pre-fix: useQueueAutoPopulate only fetched episodes in the current season.
// When the current episode was the season finale (only 1 remaining in season),
// the queue had no next item and PostPlay never advanced.
// Post-fix: when remainingInSeason.length === 1, the next season's episodes
// are fetched and appended.
//
// Web-observable path: navigating to /item/<episode_id> on an episode that
// is the last in its season should trigger the auto-populate logic.  But
// this depends on Player.tsx being active (session open), which is blocked
// by the isLoading guard as described above for fix 6mi.
//
// The cross-season append (0cs) is NOT web-observable: the full assertion
// (queue gains a next item from season N+1) requires an active Player
// session, which is blocked in the web build by the isLoading guard as
// described above for fix 6mi.  No E2E test is added here — a season-finale
// detail-page render check would pass against pre-fix code too (the page
// always renders; only the queue state differed), so it would be a smoke
// test masquerading as fix coverage, not a regression guard.
//
// The cross-season append is covered by unit tests in
// src/hooks/player/useQueueAutoPopulate.test.tsx (verified present): the
// "cross-season append (BUG 2 fix)" describe block asserts next-season
// episodes are appended only when the current episode is the last in its
// season — these PASS post-fix and FAIL pre-fix (pre-fix never fetched the
// next season).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FIX §4 — Dashboard does NOT re-render on minimize toggle
//
// Pre-fix: PlayerContext was a single context; isMinimized changes invalidated
// every consumer including Dashboard, causing poster grid re-renders and
// potential duplicate API fetches on every minimize/restore cycle.
// Post-fix: PlayerContext was split into PlayerSessionContext (session state)
// and PlayerMinimizeContext (minimize state).  Dashboard consumes only
// PlayerSessionContext via usePlayerSession, so minimize-state changes
// do NOT invalidate its subtree.
//
// This fix is NOT web-observable as a Playwright E2E spec: the regression
// only manifests on a minimize/restore toggle, and minimize state can only
// be changed from inside the Player overlay, which requires an active
// player session that the web build blocks via the isLoading guard (see
// fix 6mi above).  A "sections fetched once on initial load" check would
// never trigger a minimize toggle, so it passes against pre-fix code too —
// that would be a structural smoke test, not a regression guard, and is
// omitted here to avoid fabricated fix coverage.
//
// Unit coverage of the PlayerContext split (PlayerSessionContext vs
// PlayerMinimizeContext re-render isolation) is not verified by me — no
// asserted unit-test path is claimed here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FIX §6 — Dashboard staggered fade-in via PosterCard index prop
//
// Pre-fix: PosterCard had no `index` prop; all cards received the same
// animation-delay (effectively 0), so all tiles faded in simultaneously.
// Post-fix: Dashboard passes the map index to each PosterCard; the component
// computes animationDelay = min(index, 8) * 30ms and applies it inline.
// ---------------------------------------------------------------------------
test.describe("fix §6 — poster cards have staggered animation-delay", () => {
  test("Continue Watching poster cards have increasing animation-delay by index", async ({
    page,
  }) => {
    await page.route("**/library/onDeck*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.onDeckWithItems),
      }),
    );

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Continue Watching" }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Collect all card-enter elements inside the Continue Watching row.
    // PosterCard root div has className="card-enter" and role="button".
    const cards = page.getByRole("button").filter({
      has: page.locator(".card-enter"),
    });

    // onDeckWithItems has 2 items, so we expect at least 2 cards
    const cardCount = await page.locator(".card-enter").count();
    expect(cardCount).toBeGreaterThanOrEqual(2);

    // Collect animation-delay values for all cards in the row
    const delays = await page.evaluate(() => {
      const cardEls = Array.from(document.querySelectorAll(".card-enter"));
      return cardEls.map((el) => (el as HTMLElement).style.animationDelay);
    });

    // The first card (index=0) has staggerDelayMs=0 → no animationDelay set.
    // The second card (index=1) has staggerDelayMs=30ms → animationDelay="30ms".
    // Pre-fix: no index prop was passed → all cards had no animationDelay.
    // Post-fix: index>0 cards get an explicit animationDelay.
    const nonZeroDelays = delays.filter((d) => d && d !== "" && d !== "0ms");
    expect(nonZeroDelays.length).toBeGreaterThanOrEqual(1);

    // Confirm the second card has the expected 30ms delay
    const secondCardDelay = delays[1];
    expect(secondCardDelay).toBe("30ms");
  });

  test("Recently Added in Movies poster cards also have staggered animation-delay", async ({
    page,
  }) => {
    await page.route("**/library/recentlyAdded*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.recentlyAddedWithItems),
      }),
    );

    await page.goto("/");
    await expect(page.getByText("Recently Added in Movies")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // recentlyAddedWithItems has 3 movies, so we expect 3 cards with
    // animation-delays of "" (0ms), "30ms", "60ms"
    const delays = await page.evaluate(() => {
      const cardEls = Array.from(document.querySelectorAll(".card-enter"));
      return cardEls.map((el) => (el as HTMLElement).style.animationDelay);
    });

    // Third card (index=2) should have 60ms delay
    // Pre-fix: all cards had no animationDelay (index prop not passed)
    // Post-fix: index 2 → min(2,8)*30 = 60ms
    const hasThirdCardDelay = delays.some((d) => d === "60ms");
    expect(hasThirdCardDelay).toBe(true);
  });
});
