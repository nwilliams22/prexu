import { test, expect } from "@playwright/test";
import { tauriStubScript, mockPlexData } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

const isAppRequest = (url: string) => url.includes("localhost:1420");

test.describe("Playlists: with data", () => {
  test.beforeEach(async ({ page }) => {
    // This route override runs AFTER setupAuthenticatedState, so LIFO means
    // it takes priority over the default empty playlists route.
    await page.route("**/playlists*", (route) => {
      if (isAppRequest(route.request().url())) return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.playlists),
      });
    });
  });

  test("renders Playlists heading", async ({ page }) => {
    await page.goto("/playlists");
    await expect(page.getByRole("heading", { name: "Playlists" })).toBeVisible();
  });

  test("shows playlist count", async ({ page }) => {
    await page.goto("/playlists");
    await expect(page.getByText("2 playlists")).toBeVisible();
  });

  test("shows playlist cards with titles", async ({ page }) => {
    await page.goto("/playlists");
    await expect(page.getByText("My Favorites")).toBeVisible();
    await expect(page.getByText("Weekend Binge")).toBeVisible();
  });

  test("shows item count on playlist cards", async ({ page }) => {
    await page.goto("/playlists");
    await expect(page.getByText("12 items")).toBeVisible();
    await expect(page.getByText("5 items")).toBeVisible();
  });

  test("navigates to playlist detail on click", async ({ page }) => {
    await page.goto("/playlists");
    await page.getByText("My Favorites").click();
    await expect(page).toHaveURL(/\/playlist\/300/);
  });
});

test.describe("Playlists: empty state", () => {
  test("shows empty state when no playlists", async ({ page }) => {
    // Default mock from setupAuthenticatedState returns empty playlists
    await page.goto("/playlists");
    await expect(page.getByText("No playlists")).toBeVisible();
  });
});

test.describe("Playlists: responsive", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/playlists*", (route) => {
      if (isAppRequest(route.request().url())) return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.playlists),
      });
    });
  });

  test("renders on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/playlists");
    await expect(page.getByText("My Favorites")).toBeVisible();
  });

  test("renders on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/playlists");
    await expect(page.getByText("My Favorites")).toBeVisible();
  });
});
