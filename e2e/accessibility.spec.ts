import { test, expect } from "@playwright/test";
import { tauriStubScript } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
});

test.describe("Accessibility: Login page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test("login page has no missing alt attributes on images", async ({ page }) => {
    await page.goto("/");
    const images = page.locator("img:not([alt])");
    await expect(images).toHaveCount(0);
  });

  test("login heading has proper heading hierarchy", async ({ page }) => {
    await page.goto("/");
    const h1 = page.locator("h1");
    const count = await h1.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("sign-in button is keyboard focusable", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: /sign in with plex/i });
    await button.focus();
    await expect(button).toBeFocused();
  });

  test("login page has no duplicate IDs", async ({ page }) => {
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

test.describe("Accessibility: Authenticated pages", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedState(page);
  });

  test("sidebar navigation landmark exists", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();
  });

  test("sidebar buttons are keyboard navigable", async ({ page }) => {
    await page.goto("/");
    const homeButton = page.getByTitle("Home");
    await homeButton.focus();
    await expect(homeButton).toBeFocused();
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();
  });

  test("no duplicate IDs on dashboard", async ({ page }) => {
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

  test("settings page is keyboard accessible", async ({ page }) => {
    await page.goto("/settings");
    // Wait for the settings heading to ensure the page is fully loaded
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
    // Click the body first to ensure the page has focus, then Tab
    await page.locator("body").click();
    await page.keyboard.press("Tab");
    // Verify some element received focus
    const hasFocus = await page.evaluate(
      () => document.activeElement !== document.body && document.activeElement !== null,
    );
    expect(hasFocus).toBe(true);
  });

  test("all interactive elements have visible labels or aria-labels", async ({ page }) => {
    await page.goto("/");
    const unlabeledButtons = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons
        .filter((btn) => {
          const text = btn.textContent?.trim();
          const ariaLabel = btn.getAttribute("aria-label");
          const title = btn.getAttribute("title");
          const hasLabelledBy = btn.getAttribute("aria-labelledby");
          return !text && !ariaLabel && !title && !hasLabelledBy;
        })
        .map((btn) => btn.outerHTML.substring(0, 100));
    });
    expect(unlabeledButtons).toHaveLength(0);
  });
});

test.describe("Accessibility: Responsive viewports", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test("login page is readable at 200% zoom (640x400 viewport)", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "Prexu" });
    await expect(heading).toBeVisible();
    const button = page.getByRole("button", { name: /sign in with plex/i });
    await expect(button).toBeVisible();
  });

  test("login page renders at minimum supported width (320px)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Prexu" }),
    ).toBeVisible();
  });
});
