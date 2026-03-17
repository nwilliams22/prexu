import { test, expect } from "@playwright/test";
import { tauriStubScript, mockPlexData } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

test.describe("Performance: Dashboard", () => {
  test("dashboard loads and renders within 3 seconds", async ({ page }) => {
    const startTime = Date.now();
    await page.goto("/");
    // Wait for the navigation sidebar to appear (indicates app is loaded)
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(3000);
  });

  test("dashboard with content loads within 4 seconds", async ({ page }) => {
    await page.route("**/library/onDeck*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.onDeckWithItems),
      })
    );
    // Override recentlyAdded — the dashboard calls /library/recentlyAdded (global)
    await page.route("**/library/recentlyAdded*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.recentlyAddedWithItems),
      })
    );
    const startTime = Date.now();
    await page.goto("/");
    // Use heading role to avoid matching hero badge
    await expect(page.getByRole("heading", { name: "Continue Watching" })).toBeVisible();
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(4000);
  });

  test("dashboard Time to Interactive (TTI) is reasonable", async ({ page }) => {
    await page.goto("/");
    // Measure when the page becomes interactive by checking a clickable element
    const startTime = Date.now();
    const homeButton = page.getByTitle("Home");
    await expect(homeButton).toBeVisible();
    await expect(homeButton).toBeEnabled();
    const tti = Date.now() - startTime;
    expect(tti).toBeLessThan(3000);
  });

  test("dashboard navigation performance metrics are within budget", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const metrics = await page.evaluate(() => {
      const perf = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return {
        domContentLoaded: perf.domContentLoadedEventEnd - perf.startTime,
        domInteractive: perf.domInteractive - perf.startTime,
        loadComplete: perf.loadEventEnd - perf.startTime,
      };
    });

    // DOM should be interactive within 2 seconds
    expect(metrics.domInteractive).toBeLessThan(2000);
    // DOMContentLoaded within 2.5 seconds
    expect(metrics.domContentLoaded).toBeLessThan(2500);
  });
});

test.describe("Performance: Library", () => {
  test("library page loads within 3 seconds", async ({ page }) => {
    // Filter option routes are handled by **/library/** catch-all in setupAuthenticatedState
    const startTime = Date.now();
    await page.goto("/library/1");
    await expect(page.getByRole("heading", { name: "Movies" })).toBeVisible();
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(3000);
  });

  test("library renders items within 4 seconds", async ({ page }) => {
    const startTime = Date.now();
    await page.goto("/library/1");
    await expect(page.getByText("Test Movie 1")).toBeVisible();
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(4000);
  });

  test("library with large dataset loads within 5 seconds", async ({ page }) => {
    // Create a large mock dataset with 50 items
    const largeData = {
      MediaContainer: {
        size: 50,
        totalSize: 50,
        Metadata: Array.from({ length: 50 }, (_, i) => ({
          ratingKey: String(1000 + i),
          key: `/library/metadata/${1000 + i}`,
          type: "movie",
          title: `Movie ${i + 1}`,
          titleSort: `Movie ${String(i + 1).padStart(3, "0")}`,
          year: 2020 + (i % 5),
          thumb: `/library/metadata/${1000 + i}/thumb`,
          art: `/library/metadata/${1000 + i}/art`,
          addedAt: 1700000000 + i,
          updatedAt: 1700000000 + i,
        })),
      },
    };
    await page.route("**/library/sections/*/all*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(largeData),
      })
    );
    const startTime = Date.now();
    await page.goto("/library/1");
    await expect(page.getByText("Movie 1", { exact: true })).toBeVisible();
    await expect(page.getByText(/50 movies/)).toBeVisible();
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(5000);
  });

  test("navigation between pages is fast", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();

    // Navigate to library
    const startTime = Date.now();
    await page.goto("/library/1");
    await expect(page.getByRole("heading", { name: "Movies" })).toBeVisible();
    const navTime = Date.now() - startTime;
    expect(navTime).toBeLessThan(3000);
  });
});

test.describe("Performance: Search", () => {
  test("search results appear within 3 seconds", async ({ page }) => {
    await page.route("**/hubs/search*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.searchResults),
      })
    );
    const startTime = Date.now();
    await page.goto("/search?q=test");
    await expect(page.getByText("Test Movie 1")).toBeVisible();
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(3000);
  });
});

test.describe("Performance: Settings", () => {
  test("settings page loads within 2 seconds", async ({ page }) => {
    const startTime = Date.now();
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(2000);
  });
});

test.describe("Performance: Memory", () => {
  test("no excessive DOM nodes on dashboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const nodeCount = await page.evaluate(() => document.querySelectorAll("*").length);
    // Dashboard should not have more than 2000 DOM nodes
    expect(nodeCount).toBeLessThan(2000);
  });

  test("no excessive DOM nodes on library page", async ({ page }) => {
    await page.goto("/library/1");
    await page.waitForLoadState("networkidle");

    const nodeCount = await page.evaluate(() => document.querySelectorAll("*").length);
    expect(nodeCount).toBeLessThan(2000);
  });

  test("no memory leaks after navigation cycle", async ({ page }) => {
    // Navigate through multiple pages and check that DOM doesn't accumulate
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.goto("/library/1");
    await page.waitForLoadState("networkidle");

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const nodeCount = await page.evaluate(() => document.querySelectorAll("*").length);
    expect(nodeCount).toBeLessThan(2000);
  });
});
