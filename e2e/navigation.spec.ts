import { test, expect } from "@playwright/test";
import { tauriStubScript } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

test.describe("Authenticated navigation", () => {
  test("dashboard loads as the home page", async ({ page }) => {
    await page.goto("/");
    // Should not be on the login page
    await expect(
      page.getByRole("button", { name: /sign in with plex/i }),
    ).not.toBeVisible();
  });

  test("sidebar shows main navigation", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();
  });

  test("sidebar Home button has aria-current when on dashboard", async ({ page }) => {
    await page.goto("/");
    const homeButton = page.getByTitle("Home");
    await expect(homeButton).toBeVisible();
    await expect(homeButton).toHaveAttribute("aria-current", "page");
  });

  test("navigates to settings page", async ({ page }) => {
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: /settings/i }),
    ).toBeVisible();
  });

  test("navigates to playlists page", async ({ page }) => {
    await page.goto("/playlists");
    await expect(page.locator("body")).toBeVisible();
  });

  test("navigates to watch history page", async ({ page }) => {
    await page.goto("/history");
    await expect(page.locator("body")).toBeVisible();
  });

  test("navigates to search page", async ({ page }) => {
    await page.goto("/search?q=test");
    await expect(page.locator("body")).toBeVisible();
  });

  test("unknown routes redirect to dashboard", async ({ page }) => {
    await page.goto("/nonexistent-page");
    await expect(page).toHaveURL("/");
  });
});
