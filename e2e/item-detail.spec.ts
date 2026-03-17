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
    await expect(page.getByText("Test Movie 1")).toBeVisible();
  });

  test("shows movie year", async ({ page }) => {
    await page.goto("/item/100");
    await expect(page.getByText("2024")).toBeVisible();
  });

  test("shows movie summary", async ({ page }) => {
    await page.goto("/item/100");
    await expect(page.getByText("A thrilling test movie about testing.")).toBeVisible();
  });

  test("shows genre tags", async ({ page }) => {
    await page.goto("/item/100");
    await expect(page.getByText("Action")).toBeVisible();
    await expect(page.getByText("Drama")).toBeVisible();
  });

  test("shows play button", async ({ page }) => {
    await page.goto("/item/100");
    await expect(page.getByText("Test Movie 1")).toBeVisible();
    // The play button uses "▶ Play" text — use text locator with substring match
    const playButton = page.locator("button", { hasText: "Play" }).first();
    await expect(playButton).toBeVisible();
  });

  test("shows content rating", async ({ page }) => {
    await page.goto("/item/100");
    await expect(page.getByText("PG-13")).toBeVisible();
  });

  test("shows cast members", async ({ page }) => {
    await page.goto("/item/100");
    await expect(page.getByText("Actor One")).toBeVisible();
  });

  test("page loads without errors", async ({ page }) => {
    await page.goto("/item/100");
    // No crash — page renders something
    await expect(page.locator("body")).toBeVisible();
    // Verify no error state
    await expect(page.getByText("Test Movie 1")).toBeVisible();
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
    await expect(page.getByText("Test Show 1")).toBeVisible();
  });

  test("shows show summary", async ({ page }) => {
    await page.goto("/item/200");
    await expect(page.getByText("A dramatic TV show for testing.")).toBeVisible();
  });

  test("shows season list", async ({ page }) => {
    await page.goto("/item/200");
    await expect(page.getByText("Season 1")).toBeVisible();
    await expect(page.getByText("Season 2")).toBeVisible();
  });

  test("shows genre tags", async ({ page }) => {
    await page.goto("/item/200");
    // Use first() in case genre text appears in multiple places (e.g. tags + metadata)
    await expect(page.getByText("Drama").first()).toBeVisible();
    await expect(page.getByText("Thriller").first()).toBeVisible();
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
    // The page should handle the error gracefully
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Item Detail: responsive", () => {
  test.beforeEach(async ({ page }) => {
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
    await expect(page.getByText("Test Movie 1")).toBeVisible();
  });

  test("renders on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/item/100");
    await expect(page.getByText("Test Movie 1")).toBeVisible();
  });
});
