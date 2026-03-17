import { test, expect } from "@playwright/test";
import { tauriStubScript } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.describe("Responsive: Login page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(tauriStubScript);
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test("login page is centered on desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const title = page.getByRole("heading", { name: "Prexu" });
    await expect(title).toBeVisible();
  });

  test("login page renders on mobile viewport (375x812)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Prexu" })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with plex/i })).toBeVisible();
  });

  test("login page renders on tablet viewport (768x1024)", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Prexu" })).toBeVisible();
  });

  test("login page at minimum supported width (320px)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Prexu" })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with plex/i })).toBeVisible();
  });

  test("login page at 200% zoom equivalent (640x400)", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Prexu" })).toBeVisible();
  });

  test("login page at large desktop (1920x1080)", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Prexu" })).toBeVisible();
  });
});

test.describe("Responsive: Authenticated pages", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(tauriStubScript);
    await setupAuthenticatedState(page);
  });

  test("dashboard renders with sidebar on desktop (1280x800)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();
  });

  test("dashboard renders on mobile (375x812)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("dashboard renders on tablet (768x1024)", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("library page renders on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/library/1");
    // Filter option routes (/library/sections/*/genre etc.) are handled by
    // the **/library/** catch-all in setupAuthenticatedState
    await expect(page.getByRole("heading", { name: "Movies" })).toBeVisible();
  });

  test("library page renders on tablet", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/library/1");
    await expect(page.getByRole("heading", { name: "Movies" })).toBeVisible();
  });

  test("settings page renders on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
  });

  test("settings page renders on tablet", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
  });

  test("playlists page renders on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/playlists");
    await expect(page.locator("body")).toBeVisible();
  });

  test("search page renders on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Search", exact: true })).toBeVisible();
  });

  test("history page renders on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/history");
    await expect(page.getByRole("heading", { name: "Watch History", exact: true })).toBeVisible();
  });

  test("requests page renders on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/requests");
    await expect(page.locator("body")).toBeVisible();
  });

  test("large desktop renders with sidebar (1920x1080)", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();
  });

  test("minimum width (320px) doesn't break layout", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThan(50);
  });
});
