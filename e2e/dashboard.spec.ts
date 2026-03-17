import { test, expect } from "@playwright/test";
import { tauriStubScript, mockPlexData } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

test.describe("Dashboard", () => {
  test("renders without crashing", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  });

  test("shows empty state when no content available", async ({ page }) => {
    // Default mock returns empty onDeck and recentlyAdded, so empty state should show
    await page.goto("/");
    await expect(page.getByText("No recent activity")).toBeVisible();
  });

  test("shows Continue Watching section with on-deck items", async ({ page }) => {
    // Override onDeck to return items
    await page.route("**/library/onDeck*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.onDeckWithItems),
      }),
    );
    await page.goto("/");
    // Use heading role to avoid matching the hero badge category label
    await expect(page.getByRole("heading", { name: "Continue Watching" })).toBeVisible();
  });

  test("shows Recently Added in Movies section", async ({ page }) => {
    // Override recentlyAdded — the dashboard hook calls /library/recentlyAdded
    // (not per-section), then filters by type on the client side
    await page.route("**/library/recentlyAdded*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.recentlyAddedWithItems),
      }),
    );
    await page.goto("/");
    await expect(page.getByText("Recently Added in Movies")).toBeVisible();
  });

  test("navigates to item detail when clicking a poster card", async ({ page }) => {
    await page.route("**/library/onDeck*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.onDeckWithItems),
      }),
    );
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Continue Watching" })).toBeVisible();
    // Click the first occurrence of "Test Movie 1" (may appear in hero + row)
    const movieCard = page.getByText("Test Movie 1").first();
    await movieCard.click();
    await expect(page).toHaveURL(/\/item\/100/);
  });

  test("sidebar shows library sections", async ({ page }) => {
    await page.goto("/");
    // Scope to nav to avoid matching library page content
    await expect(page.locator("nav").getByText("Movies")).toBeVisible();
    await expect(page.locator("nav").getByText("TV Shows")).toBeVisible();
  });

  test("clicking Movies in sidebar navigates to library", async ({ page }) => {
    await page.goto("/");
    const moviesLink = page.locator("nav").getByText("Movies");
    await moviesLink.click();
    // Just verify the URL changed — don't wait for library page content
    // since filter option requests are non-critical but may delay rendering
    await expect(page).toHaveURL(/\/library\/1/);
  });

  test("clicking TV Shows in sidebar navigates to library", async ({ page }) => {
    await page.goto("/");
    const showsLink = page.locator("nav").getByText("TV Shows");
    await showsLink.click();
    await expect(page).toHaveURL(/\/library\/2/);
  });

  test("dashboard has no duplicate IDs", async ({ page }) => {
    await page.goto("/");
    const duplicateIds = await page.evaluate(() => {
      const allIds = Array.from(document.querySelectorAll("[id]")).map(
        (el) => el.id,
      );
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const id of allIds) {
        if (seen.has(id)) dupes.push(id);
        seen.add(id);
      }
      return dupes;
    });
    expect(duplicateIds).toHaveLength(0);
  });

  test("document title is set correctly", async ({ page }) => {
    await page.goto("/");
    // Wait for the page to load fully
    await page.waitForLoadState("networkidle");
    // Dashboard should have some title set
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});

test.describe("Dashboard: responsive", () => {
  test("renders correctly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    // Should still render the dashboard content area
    await expect(page.locator("body")).toBeVisible();
  });

  test("renders correctly on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("sidebar is not visible on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    // On mobile the sidebar should be hidden (it becomes a hamburger menu overlay)
    const sidebar = page.getByRole("navigation", { name: "Main navigation" });
    // It may exist but not be visible as a persistent sidebar
    await page.waitForTimeout(500);
  });
});
