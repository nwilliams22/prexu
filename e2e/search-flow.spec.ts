import { test, expect } from "@playwright/test";
import { tauriStubScript, mockPlexData } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

test.describe("Search: no query", () => {
  test("shows Search heading when no query", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Search", exact: true })).toBeVisible();
  });

  test("shows prompt to start typing", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByText("Start typing to search your libraries")).toBeVisible();
  });
});

test.describe("Search: with results", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/hubs/search*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.searchResults),
      })
    );
  });

  test("shows results heading with query", async ({ page }) => {
    await page.goto("/search?q=test");
    await expect(page.getByRole("heading", { name: /Results for/ })).toBeVisible();
  });

  test("shows Movies hub with results", async ({ page }) => {
    await page.goto("/search?q=test");
    await expect(page.getByText("Movies")).toBeVisible();
    await expect(page.getByText("Test Movie 1")).toBeVisible();
  });

  test("shows TV Shows hub with results", async ({ page }) => {
    await page.goto("/search?q=test");
    await expect(page.getByText("TV Shows")).toBeVisible();
    await expect(page.getByText("Test Show 1")).toBeVisible();
  });

  test("navigates to item detail when clicking search result", async ({ page }) => {
    await page.goto("/search?q=test");
    await page.getByText("Test Movie 1").click();
    await expect(page).toHaveURL(/\/item\/100/);
  });

  test("sets document title with query", async ({ page }) => {
    await page.goto("/search?q=test");
    await expect(page.getByRole("heading", { name: /Results for/ })).toBeVisible();
    const title = await page.title();
    // Title is "Search Results - Prexu"
    expect(title).toMatch(/Search/);
    expect(title).toMatch(/Prexu/);
  });
});

test.describe("Search: empty results", () => {
  test("shows no results message for unmatched query", async ({ page }) => {
    await page.route("**/hubs/search*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.emptySearch),
      })
    );
    await page.goto("/search?q=xyznonexistent");
    await expect(page.getByText(/No results found/)).toBeVisible();
  });
});

test.describe("Search: responsive", () => {
  test("renders on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Search", exact: true })).toBeVisible();
  });

  test("renders results on tablet viewport", async ({ page }) => {
    await page.route("**/hubs/search*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.searchResults),
      })
    );
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/search?q=test");
    await expect(page.getByText("Test Movie 1")).toBeVisible();
  });
});
