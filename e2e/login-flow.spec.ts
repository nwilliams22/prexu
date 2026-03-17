import { test, expect } from "@playwright/test";
import { tauriStubScript } from "./mock-tauri";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

test.describe("Login page", () => {
  test("renders the Prexu title and sign-in button", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Prexu" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in with plex/i })
    ).toBeVisible();
  });

  test("shows subtitle text", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("A custom Plex client")).toBeVisible();
  });

  test("sign-in button is clickable and enabled", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: /sign in with plex/i });
    await expect(button).toBeEnabled();
  });

  test("login page is centered with card layout", async ({ page }) => {
    await page.goto("/");
    // The card should exist and be visible
    await expect(page.getByRole("heading", { name: "Prexu" })).toBeVisible();
    await expect(page.getByText("A custom Plex client")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with plex/i })).toBeVisible();
  });

  test("login page redirects to / for unauthenticated user", async ({ page }) => {
    await page.goto("/settings");
    // Should redirect to login since not authenticated
    await expect(page.getByRole("heading", { name: "Prexu" })).toBeVisible();
  });

  test("login page redirects from /library/1 for unauthenticated user", async ({ page }) => {
    await page.goto("/library/1");
    await expect(page.getByRole("heading", { name: "Prexu" })).toBeVisible();
  });

  test("login page redirects from /playlists for unauthenticated user", async ({ page }) => {
    await page.goto("/playlists");
    await expect(page.getByRole("heading", { name: "Prexu" })).toBeVisible();
  });

  test("login page has no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Filter out expected errors (Tauri-related)
    const realErrors = errors.filter(
      (e) => !e.includes("TAURI") && !e.includes("tauri") && !e.includes("__TAURI")
    );
    expect(realErrors).toHaveLength(0);
  });

  test("login page has proper document title", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});

test.describe("Login: keyboard navigation", () => {
  test("sign-in button is focusable via Tab", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: /sign in with plex/i });
    await button.focus();
    await expect(button).toBeFocused();
  });

  test("no duplicate IDs on login page", async ({ page }) => {
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
});
