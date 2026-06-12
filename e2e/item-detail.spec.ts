import { test, expect } from "@playwright/test";
import { tauriStubScript, mockPlexData } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

test.describe("Item Detail: Movie", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/library/metadata/100?*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.movieDetail),
      })
    );
    await page.route("**/library/metadata/100", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.movieDetail),
      })
    );
    // /similar is tried first by getRelatedItems for movies
    await page.route("**/library/metadata/100/similar*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.similarItems),
      })
    );
    // Related and extras endpoints
    await page.route("**/library/metadata/100/related*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
      })
    );
    await page.route("**/library/metadata/100/extras*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
      })
    );
  });

  test("shows movie title", async ({ page }) => {
    await page.goto("/item/100");
    await expect(page.getByRole("heading", { name: "Test Movie 1", level: 1 })).toBeVisible();
  });

  test("shows movie year", async ({ page }) => {
    await page.goto("/item/100");
    // Scope to the hero meta row to avoid matching year text elsewhere (e.g. similar items)
    await expect(page.locator("[data-testid='hero-meta-row']").getByText("2024")).toBeVisible();
  });

  test("shows movie summary", async ({ page }) => {
    await page.goto("/item/100");
    await expect(page.getByText("A thrilling test movie about testing.")).toBeVisible();
  });

  test("shows genre tags", async ({ page }) => {
    await page.goto("/item/100");
    // Scope genre assertions to the hero genre row to avoid similar/related card collisions
    const genreRow = page.locator("[data-testid='hero-genre-row']");
    await expect(genreRow.getByText("Action")).toBeVisible();
    await expect(genreRow.getByText("Drama")).toBeVisible();
  });

  test("shows play button", async ({ page }) => {
    await page.goto("/item/100");
    await expect(page.getByRole("heading", { name: "Test Movie 1", level: 1 })).toBeVisible();
    // The movie has a viewOffset so a "Resume" button appears — use role to avoid text collisions
    const playButton = page.getByRole("button", { name: /resume|play/i }).first();
    await expect(playButton).toBeVisible();
  });

  test("shows content rating", async ({ page }) => {
    await page.goto("/item/100");
    await expect(page.getByText("PG-13")).toBeVisible();
  });

  test("shows cast members", async ({ page }) => {
    await page.goto("/item/100");
    // "Actor One" is in cast section (overflow:hidden PosterCard-style buttons).
    // Assert it exists in DOM; also confirm the Cast & Crew section heading is visible.
    await expect(page.getByText("Actor One").first()).toBeAttached();
    await expect(page.getByText("Cast & Crew")).toBeVisible();
  });

  test("page loads without errors", async ({ page }) => {
    await page.goto("/item/100");
    // Verify the h1 renders — stronger than body visibility check
    await expect(page.getByRole("heading", { name: "Test Movie 1", level: 1 })).toBeVisible();
    // Verify the related section rendered from /similar.
    // PosterCard titles use overflow:hidden so use toBeAttached instead of toBeVisible.
    await expect(page.getByText("Similar Movie A")).toBeAttached();
  });
});

test.describe("Item Detail: Show", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/library/metadata/200?*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.showDetail),
      })
    );
    await page.route("**/library/metadata/200", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.showDetail),
      })
    );
    await page.route("**/library/metadata/200/children*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.seasons),
      })
    );
    // /similar is tried first by getRelatedItems for shows
    await page.route("**/library/metadata/200/similar*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.similarShows),
      })
    );
    await page.route("**/library/metadata/200/related*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
      })
    );
    await page.route("**/library/metadata/200/extras*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
      })
    );
  });

  test("shows show title", async ({ page }) => {
    await page.goto("/item/200");
    await expect(page.getByRole("heading", { name: "Test Show 1", level: 1 })).toBeVisible();
  });

  test("shows show summary", async ({ page }) => {
    await page.goto("/item/200");
    await expect(page.getByText("A dramatic TV show for testing.")).toBeVisible();
  });

  test("shows season list", async ({ page }) => {
    await page.goto("/item/200");
    // Scope to the Seasons section heading to confirm the grid rendered
    await expect(page.getByRole("heading", { name: "Seasons", level: 2 })).toBeVisible();
    await expect(page.getByText("Season 1")).toBeVisible();
    await expect(page.getByText("Season 2")).toBeVisible();
  });

  test("shows genre tags", async ({ page }) => {
    await page.goto("/item/200");
    // Scope to the hero genre row to avoid similar/related card collisions
    const genreRow = page.locator("[data-testid='hero-genre-row']");
    await expect(genreRow.getByText("Drama")).toBeVisible();
    await expect(genreRow.getByText("Thriller")).toBeVisible();
  });

  test("shows related shows from /similar", async ({ page }) => {
    await page.goto("/item/200");
    // PosterCard titles use overflow:hidden so they may not pass toBeVisible.
    // Assert the element is in the DOM (proves /similar was fetched + rendered).
    await expect(page.getByText("Similar Show A")).toBeAttached();
  });
});

test.describe("Item Detail: error handling", () => {
  test("shows error when item not found", async ({ page }) => {
    await page.route("**/library/metadata/999*", route =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
      })
    );
    await page.goto("/item/999");
    // The page should render an error state, not crash
    await expect(page.getByText(/not found|error/i)).toBeVisible();
  });
});

test.describe("Item Detail: responsive", () => {
  test.beforeEach(async ({ page }) => {
    // Specific sub-resource routes registered first (lower LIFO priority)
    // so the item catch-all below doesn't swallow them with wrong payload.
    await page.route("**/library/metadata/100/similar*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.similarItems),
      })
    );
    await page.route("**/library/metadata/100/related*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
      })
    );
    await page.route("**/library/metadata/100/extras*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
      })
    );
    // Catch-all for the item itself (registered last = highest LIFO priority)
    await page.route("**/library/metadata/100*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.movieDetail),
      })
    );
  });

  test("renders on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/item/100");
    await expect(page.getByRole("heading", { name: "Test Movie 1", level: 1 })).toBeVisible();
  });

  test("renders on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/item/100");
    await expect(page.getByRole("heading", { name: "Test Movie 1", level: 1 })).toBeVisible();
  });
});
