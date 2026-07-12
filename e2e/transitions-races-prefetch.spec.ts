/**
 * W3 Playwright pack (prexu-pd1x.3): the interaction behaviors that regressed
 * recently but had no E2E coverage —
 *   - route-transition overlay is NOT shown on ordinary nav (PR #75 / prexu-xb3h)
 *   - back/POP scroll restoration on a library grid
 *   - library filter/sort race: prior items stay dimmed, last selection wins
 *   - ItemDetail shows a skeleton (not a spinner) under a delayed metadata route
 *   - hover-intent prefetch fires exactly once on dwell, never on a fast sweep
 *   - CollectionDetail fetches metadata only for the visible virtual window
 *
 * Runs against the mock-tauri browser build. NEVER set window.__TAURI_INTERNALS__
 * (see e2e/mock-tauri.ts) — interception is purely at the fetch/HTTP layer via
 * page.route(), which uses LIFO priority (a route registered later wins), so the
 * per-test routes below override the catch-alls from setupAuthenticatedState.
 */
import { test, expect, type Route, type Page } from "@playwright/test";
import { tauriStubScript, mockPlexData } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

async function boot(page: Page) {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
  // The reachability probe hits {server}/identity (server-reachability.ts); if it
  // is left unmocked it fails and the "Server unreachable" banner overlays the UI
  // and intercepts pointer events. Keep the server "reachable" for these specs.
  await page.route("**/identity*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ MediaContainer: { machineIdentifier: "machine-id-123", version: "1.40" } }),
    }),
  );
}

// A movie metadata record with a stable, assertable title.
function movie(ratingKey: number, title: string, extra: Record<string, unknown> = {}) {
  return {
    ratingKey: String(ratingKey),
    key: `/library/metadata/${ratingKey}`,
    type: "movie",
    title,
    titleSort: title,
    year: 2000 + (ratingKey % 30),
    thumb: `/library/metadata/${ratingKey}/thumb`,
    art: `/library/metadata/${ratingKey}/art`,
    addedAt: 1700000000 + ratingKey,
    updatedAt: 1700000000 + ratingKey,
    viewCount: 0,
    ...extra,
  };
}

// Fulfill a paginated Plex container, honoring X-Plex-Container-Start/Size so the
// app's chunked fetch places items at the right offset and learns the real total.
async function fulfillPaginated(route: Route, all: unknown[]) {
  const url = new URL(route.request().url());
  const start = Number(url.searchParams.get("X-Plex-Container-Start") ?? 0);
  const size = Number(url.searchParams.get("X-Plex-Container-Size") ?? all.length);
  const slice = all.slice(start, start + size);
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      MediaContainer: { size: slice.length, totalSize: all.length, offset: start, Metadata: slice },
    }),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------

test.describe("route transition overlay (PR #75 / prexu-xb3h)", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    // Make /item/100 render real content so the nav is realistic.
    await page.route("**/library/metadata/100*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.movieDetail),
      }),
    );
  });

  test("ordinary in-app navigation never shows the full-screen transition overlay", async ({ page }) => {
    const overlay = page.getByTestId("route-transition-spinner");

    await page.goto("/library/1");
    await expect(page.getByText("Test Movie 1")).toBeAttached();
    await expect(overlay).toHaveCount(0);

    // Client-side nav library -> item detail (this is what the overlay reacts to;
    // a full page.goto would not exercise the router transition path).
    await page.locator(".card-enter", { hasText: "Test Movie 1" }).first().click();
    await expect(page).toHaveURL(/\/item\/100/);
    await expect(overlay).toHaveCount(0);

    // Client-side POP back to the library.
    await page.goBack();
    await expect(page).toHaveURL(/\/library\/1/);
    await expect(page.getByText("Test Movie 1")).toBeAttached();
    await expect(overlay).toHaveCount(0);
  });
});

// --------------------------------------------------------------------------

test.describe("library scroll restoration on back/POP", () => {
  const many = Array.from({ length: 60 }, (_, i) => movie(1000 + i, `Grid Movie ${String(i).padStart(2, "0")}`));

  test.beforeEach(async ({ page }) => {
    await boot(page);
    await page.route("**/library/sections/1/all*", (route) => fulfillPaginated(route, many));
    // Any grid item detail renders (catch-all returns empty, which is fine).
  });

  test("scrolling a library, opening an item, then going back restores the scroll position", async ({ page }) => {
    await page.goto("/library/1");
    await expect(page.getByText("Grid Movie 00")).toBeAttached();

    // Scroll the single app scroll container (<main>) down a good distance.
    const main = page.locator("main");
    await main.evaluate((el) => el.scrollTo(0, 1400));
    await expect.poll(() => main.evaluate((el) => (el as HTMLElement).scrollTop)).toBeGreaterThan(1200);

    // Navigate away via the FIXED header home button — NOT a grid card. Clicking a
    // card that has been scrolled out of view makes Playwright auto-scroll it into
    // view first, which resets the position we're trying to preserve.
    await page.getByRole("button", { name: "Prexu" }).click();
    await expect(page).toHaveURL(/\/$|\/\?/);
    await page.goBack();
    await expect(page).toHaveURL(/\/library\/1/);
    await expect(page.getByText("Grid Movie 00")).toBeAttached();

    // useScrollRestoration restores via rAF + a MutationObserver once the grid is
    // tall enough again; allow it to settle, then assert we're near where we left.
    await expect
      .poll(() => main.evaluate((el) => (el as HTMLElement).scrollTop), { timeout: 6000 })
      .toBeGreaterThan(1000);
  });

  test("going back restores filter/sort selection and virtual window grid state", async ({ page }) => {
    await page.goto("/library/1");
    await expect(page.getByText("Grid Movie 00")).toBeAttached();

    const sortSelect = page.getByLabel("Sort by");
    const main = page.locator("main");

    // Verify initial sort is the default (Title)
    const initialSort = await sortSelect.inputValue();
    expect(initialSort).toBe("titleSort:asc");

    // Change sort to "Date Added" (addedAt:desc) — this verifies the sort
    // control state will be preserved. The mock returns the same items regardless
    // of sort param, but the URL param should be persisted and the control
    // should reflect the user's last selection.
    await sortSelect.selectOption("addedAt:desc");

    // Wait for the sort change to apply (API request + grid re-render)
    await page.waitForLoadState("networkidle");

    // Scroll down to see items at a consistent scroll offset
    await main.evaluate((el) => el.scrollTo(0, 1400));
    await expect.poll(() => main.evaluate((el) => (el as HTMLElement).scrollTop)).toBeGreaterThan(1200);

    // Capture the first visible grid card's text content to verify the virtual
    // window state (which items are rendered) is preserved across POP navigation.
    const firstVisibleCardBefore = await page.locator(".card-enter").first().textContent();
    expect(firstVisibleCardBefore).toBeTruthy();

    // Navigate away via the fixed header home button
    await page.getByRole("button", { name: "Prexu" }).click();
    await expect(page).toHaveURL(/\/$|\/\?/);

    // Go back
    await page.goBack();
    await expect(page).toHaveURL(/\/library\/1/);

    // Assert 1: Filter/sort selection is still active — the sort dropdown
    // still reflects "Date Added" (addedAt:desc)
    await expect(sortSelect).toHaveValue("addedAt:desc");

    // Assert 2: Virtual window grid state is preserved — the same first-visible
    // grid item is still rendered (implies the grid layout and scroll context
    // are restored)
    const firstVisibleCardAfter = await page.locator(".card-enter").first().textContent();
    expect(firstVisibleCardAfter).toBe(firstVisibleCardBefore);

    // Assert 3: Scroll position is restored (from the original test requirement)
    await expect
      .poll(() => main.evaluate((el) => (el as HTMLElement).scrollTop), { timeout: 6000 })
      .toBeGreaterThan(1000);
  });
});

// --------------------------------------------------------------------------

test.describe("library filter/sort race", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("a slow sort refetch keeps the prior items dimmed (aria-busy) until results arrive", async ({ page }) => {
    // Fast initial load (default 3-movie fixture via the catch-all).
    await page.goto("/library/1");
    await expect(page.getByText("Test Movie 1")).toBeAttached();

    // Now make the NEXT /all fetch slow and return a distinct set.
    const fresh = [movie(9001, "Reordered Alpha"), movie(9002, "Reordered Beta")];
    await page.route("**/library/sections/1/all*", async (route) => {
      await sleep(1200);
      await fulfillPaginated(route, fresh);
    });

    // Trigger a sort change (drives handleSortChange -> ?sort= -> refetch).
    await page.getByLabel("Sort by").selectOption("addedAt:desc");

    // During the delay the grid is marked busy/stale and the OLD items remain.
    await expect(page.locator('main [aria-busy="true"]')).toBeVisible();
    await expect(page.getByText("Test Movie 1")).toBeAttached();

    // Then the fresh results replace them.
    await expect(page.getByText("Reordered Alpha")).toBeAttached();
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  });

  test("rapid sort switches: the last selection wins even if an earlier one resolves later", async ({ page }) => {
    await page.goto("/library/1");
    await expect(page.getByText("Test Movie 1")).toBeAttached();

    // Two concrete non-default sort values to switch between (SortBar options).
    const sortSlow = "addedAt:desc";
    const sortFast = "rating:desc";

    const slowSet = [movie(8001, "STALE Should Not Win")];
    const fastSet = [movie(8002, "WINNER Last Selection")];

    // Key the response (delay + data) on the sort param in the request URL, so the
    // earlier (slow) selection resolves AFTER the later (fast) one — the generation
    // guard must drop the stale slow response.
    await page.route("**/library/sections/1/all*", async (route) => {
      const sort = new URL(route.request().url()).searchParams.get("sort") ?? "";
      if (sort === sortSlow) {
        await sleep(1800);
        await fulfillPaginated(route, slowSet);
      } else {
        await sleep(250);
        await fulfillPaginated(route, fastSet);
      }
    });

    const select = page.getByLabel("Sort by");
    await select.selectOption(sortSlow);
    await select.selectOption(sortFast);

    // The fast (last) selection shows; the slow (earlier) response, arriving ~1.5s
    // later, must never overwrite it.
    await expect(page.getByText("WINNER Last Selection")).toBeAttached();
    await page.waitForTimeout(2200); // let the stale slow response land and be dropped
    await expect(page.getByText("WINNER Last Selection")).toBeAttached();
    await expect(page.getByText("STALE Should Not Win")).toHaveCount(0);
  });
});

// --------------------------------------------------------------------------

test.describe("ItemDetail loading state", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("shows a skeleton (not a spinner) while metadata is loading", async ({ page }) => {
    await page.route("**/library/metadata/100*", async (route) => {
      await sleep(1200);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.movieDetail),
      });
    });

    await page.goto("/item/100");

    // The DetailSkeleton (aria-busy, aria-label) is up; the spin-animated spinner
    // (used elsewhere, e.g. CollectionDetail first load) is NOT.
    await expect(page.locator('[aria-label="Loading item details"]')).toBeVisible();
    await expect(page.locator(".loading-spinner")).toHaveCount(0);

    // Then real content replaces the skeleton.
    await expect(page.getByTestId("hero-meta-row")).toBeVisible();
    await expect(page.locator('[aria-label="Loading item details"]')).toHaveCount(0);
  });
});

// --------------------------------------------------------------------------

test.describe("hover-intent prefetch", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("sustained hover prefetches an item's metadata exactly once; a fast sweep prefetches nothing", async ({
    page,
  }) => {
    const hits100: string[] = [];
    const hits101: string[] = [];
    await page.route("**/library/metadata/100*", (route) => {
      hits100.push(route.request().url());
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.movieDetail),
      });
    });
    await page.route("**/library/metadata/101*", (route) => {
      hits101.push(route.request().url());
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 1, Metadata: [movie(101, "Test Movie 2")] } }),
      });
    });

    await page.goto("/library/1");
    await expect(page.getByText("Test Movie 1")).toBeAttached();

    const card100 = page.locator(".card-enter", { hasText: "Test Movie 1" }).first();
    const card101 = page.locator(".card-enter", { hasText: "Test Movie 2" }).first();
    const box100 = await card100.boundingBox();
    const box101 = await card101.boundingBox();
    if (!box100 || !box101) throw new Error("cards not laid out");

    // Fast sweep over card 101 (dwell < HOVER_INTENT_DELAY_MS = 150ms): no prefetch.
    await page.mouse.move(box101.x + box101.width / 2, box101.y + box101.height / 2);
    await page.waitForTimeout(60);
    await page.mouse.move(5, 5); // sweep away
    await page.waitForTimeout(300);
    expect(hits101.length).toBe(0);

    // Sustained hover over card 100 (dwell > 150ms): exactly one prefetch.
    await page.mouse.move(box100.x + box100.width / 2, box100.y + box100.height / 2);
    await page.waitForTimeout(400);
    await page.mouse.move(5, 5);
    await expect.poll(() => hits100.length).toBe(1);
  });
});

// --------------------------------------------------------------------------

test.describe("CollectionDetail visible-window metadata", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("fetches metadata only for the visible virtual window, not every item", async ({ page }) => {
    const CID = 400;
    const N = 60; // >= ROW_VIRTUALIZE_THRESHOLD (50) so the list virtualizes
    const children = Array.from({ length: N }, (_, i) => movie(7000 + i, `Coll Item ${String(i).padStart(2, "0")}`));

    // Collection metadata (the page header) + the children list.
    await page.route(`**/library/metadata/${CID}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          MediaContainer: {
            size: 1,
            Metadata: [{ ratingKey: String(CID), key: `/library/metadata/${CID}`, type: "collection", title: "Big Collection", childCount: N }],
          },
        }),
      }),
    );
    await page.route(`**/library/collections/${CID}/children*`, (route) => fulfillPaginated(route, children));

    // Count per-row metadata fetches (ratingKeys 7000-7059 => /library/metadata/7*).
    const rowHits = new Set<string>();
    await page.route("**/library/metadata/7*", (route) => {
      rowHits.add(new URL(route.request().url()).pathname);
      const rk = new URL(route.request().url()).pathname.split("/").pop();
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 1, Metadata: [movie(Number(rk), `Row ${rk}`)] } }),
      });
    });

    await page.goto(`/collection/${CID}`);
    await expect(page.getByText("Coll Item 00")).toBeAttached();
    await page.waitForLoadState("networkidle");

    // Only the visible window (+overscan) should have fetched metadata — far fewer
    // than all N. Viewport ~720px / ~230px rows + 6 overscan => ~10-ish.
    const initial = rowHits.size;
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThan(30);

    // Scrolling reveals new rows, which fetch their metadata on demand.
    await page.locator("main").evaluate((el) => el.scrollTo(0, 6000));
    await expect.poll(() => rowHits.size, { timeout: 6000 }).toBeGreaterThan(initial);
    // Still bounded — never fetched all N at once.
    expect(rowHits.size).toBeLessThanOrEqual(N);
  });
});
