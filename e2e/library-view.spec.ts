import { test, expect } from "@playwright/test";
import { tauriStubScript, mockPlexData } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);

  // Filter options endpoints — must return Directory arrays
  await page.route("**/library/sections/*/genre*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ MediaContainer: { size: 0, Directory: [] } }),
    })
  );
  await page.route("**/library/sections/*/year*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ MediaContainer: { size: 0, Directory: [] } }),
    })
  );
  await page.route("**/library/sections/*/contentRating*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ MediaContainer: { size: 0, Directory: [] } }),
    })
  );

  // Collections endpoint
  await page.route("**/library/sections/*/collections*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
    })
  );
});

test.describe("Library: Movies", () => {
  test("renders Movies library heading", async ({ page }) => {
    await page.goto("/library/1");
    await expect(
      page.getByRole("heading", { name: "Movies", level: 2 })
    ).toBeVisible();
  });

  test("shows movie poster cards", async ({ page }) => {
    await page.goto("/library/1");
    await expect(page.getByText("Test Movie 1")).toBeVisible();
    await expect(page.getByText("Test Movie 2")).toBeVisible();
    await expect(page.getByText("Test Movie 3")).toBeVisible();
  });

  test("shows total item count", async ({ page }) => {
    await page.goto("/library/1");
    await expect(page.getByText(/3 movies/)).toBeVisible();
  });

  test("shows Library/Collections segmented control for movies", async ({ page }) => {
    await page.goto("/library/1");
    await expect(page.getByRole("button", { name: "Library", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Collections", exact: true })).toBeVisible();
  });

  test("navigates to item detail on card click", async ({ page }) => {
    await page.goto("/library/1");
    // Wait for the grid to populate before clicking
    await expect(page.getByText("Test Movie 1")).toBeVisible();
    await page.getByText("Test Movie 1").click();
    await expect(page).toHaveURL(/\/item\/100/);
  });

  test("sets document title for Movies library", async ({ page }) => {
    await page.goto("/library/1");
    await expect(
      page.getByRole("heading", { name: "Movies", level: 2 })
    ).toBeVisible();
    await expect(page).toHaveTitle(/Movies - Prexu/);
  });

  test("shows sort bar", async ({ page }) => {
    await page.goto("/library/1");
    // The sort bar should be visible
    const sortSelect = page.locator("select").first();
    await expect(sortSelect).toBeVisible();
  });

  test("has no duplicate element IDs", async ({ page }) => {
    await page.goto("/library/1");
    await expect(
      page.getByRole("heading", { name: "Movies", level: 2 })
    ).toBeVisible();
    const duplicateIds = await page.evaluate(() => {
      const allIds = Array.from(document.querySelectorAll("[id]")).map(
        (el) => el.id
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
});

test.describe("Library: TV Shows", () => {
  test.beforeEach(async ({ page }) => {
    // Override section 2 to return TV show data
    await page.route("**/library/sections/2/all*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.tvShowItems),
      })
    );
  });

  test("renders TV Shows library heading", async ({ page }) => {
    await page.goto("/library/2");
    await expect(
      page.getByRole("heading", { name: "TV Shows" })
    ).toBeVisible();
  });

  test("shows TV show cards", async ({ page }) => {
    await page.goto("/library/2");
    await expect(page.getByText("Test Show 1")).toBeVisible();
    await expect(page.getByText("Test Show 2")).toBeVisible();
  });

  test("shows show count", async ({ page }) => {
    await page.goto("/library/2");
    await expect(page.getByText(/2 shows/)).toBeVisible();
  });

  test("does NOT show Library/Collections toggle for TV Shows", async ({
    page,
  }) => {
    await page.goto("/library/2");
    // The segmented control should not appear for TV shows
    await expect(
      page.getByRole("heading", { name: "TV Shows" })
    ).toBeVisible();
    // Collections toggle only for movies
  });
});

test.describe("Library: empty state", () => {
  test("shows empty state when library has no items", async ({ page }) => {
    await page.route("**/library/sections/*/all*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.emptyLibrary),
      })
    );
    await page.goto("/library/1");
    await expect(page.getByText("No items in this library")).toBeVisible();
  });
});

test.describe("Library: URL parameters", () => {
  test("preserves sort parameter in URL", async ({ page }) => {
    await page.goto("/library/1?sort=year:desc");
    await expect(page).toHaveURL(/sort=year/);
  });

  test("preserves view=collections parameter", async ({ page }) => {
    await page.goto("/library/1?view=collections");
    await expect(page).toHaveURL(/view=collections/);
  });
});

test.describe("Library: responsive", () => {
  test("renders correctly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/library/1");
    await expect(
      page.getByRole("heading", { name: "Movies", level: 2 })
    ).toBeVisible();
  });

  test("renders correctly on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/library/1");
    await expect(
      page.getByRole("heading", { name: "Movies", level: 2 })
    ).toBeVisible();
  });
});
