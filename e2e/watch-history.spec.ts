import { test, expect } from "@playwright/test";
import { tauriStubScript, mockPlexData } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

test.describe("Watch History: with data", () => {
  test.beforeEach(async ({ page }) => {
    // Override the watch history endpoint to return items.
    // The accounts and myplex/account routes are already in setupAuthenticatedState.
    await page.route("**/status/sessions/history/all*", route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlexData.watchHistory),
      })
    );
  });

  test("renders Watch History heading", async ({ page }) => {
    await page.goto("/history");
    await expect(page.getByRole("heading", { name: "Watch History" })).toBeVisible();
  });

  test("shows watched count", async ({ page }) => {
    await page.goto("/history");
    await expect(page.getByText("4 watched")).toBeVisible();
  });

  test("shows watched movie titles", async ({ page }) => {
    await page.goto("/history");
    await expect(page.getByText("Test Movie 1")).toBeVisible();
    await expect(page.getByText("Test Movie 2")).toBeVisible();
  });

  test("navigates to item detail on click", async ({ page }) => {
    await page.goto("/history");
    await page.getByText("Test Movie 1").first().click();
    await expect(page).toHaveURL(/\/item\/100/);
  });
});

test.describe("Watch History: empty state", () => {
  test("shows empty state when no history", async ({ page }) => {
    // The default setupAuthenticatedState intercepts **/status/** with empty data,
    // and **/myplex/account* and **/accounts* are also intercepted.
    // So the watch history hook should resolve accountID then get empty history.
    await page.goto("/history");
    await expect(page.getByText("No watch history")).toBeVisible();
  });
});

test.describe("Watch History: responsive", () => {
  test("renders on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/history");
    await expect(page.getByRole("heading", { name: "Watch History", exact: true })).toBeVisible();
  });
});
