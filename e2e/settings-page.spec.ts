import { test, expect } from "@playwright/test";
import { tauriStubScript } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

test.describe("Settings page", () => {
  test("renders settings heading", async ({ page }) => {
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: /settings/i }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("shows Playback section", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Playback", level: 2 })).toBeVisible({ timeout: 15000 });
  });

  test("shows Appearance section", async ({ page }) => {
    await page.goto("/settings/appearance");
    await expect(page.getByRole("heading", { name: "Appearance", level: 2 })).toBeVisible();
  });

  test("shows Watch Together section", async ({ page }) => {
    await page.goto("/settings/connections");
    await expect(page.getByRole("heading", { name: "Watch Together" })).toBeVisible();
  });

  test("shows About section with version", async ({ page }) => {
    await page.goto("/settings/about");
    await expect(page.getByText(/v\d+\.\d+\.\d+/)).toBeVisible();
  });

  test("shows Content Requests section for admin users", async ({ page }) => {
    await page.goto("/settings/about");
    await expect(page.getByText("Content Requests")).toBeVisible();
  });

  test("hides Content Requests for non-admin users", async ({ page }) => {
    // Override active_user to be non-admin
    await page.addInitScript(() => {
      localStorage.setItem(
        "active_user",
        JSON.stringify({
          id: 2,
          title: "RegularUser",
          thumb: "/avatars/regular.png",
          isAdmin: false,
          token: "regular-user-token",
        }),
      );
    });
    await page.goto("/settings");
    await page.goto("/settings/about");
    await expect(page.getByText("Content Requests")).not.toBeVisible();
  });
});

test("category history, focus and unsaved relay draft survive navigation", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/playback$/);
  const category = page.getByLabel("Settings category");
  await category.selectOption("connections");
  await page.getByRole("button", { name: "Use custom relay URL" }).click();
  await page.getByPlaceholder("ws://your-server:9847/ws").fill("ws://draft.test/ws");
  await category.selectOption("about");
  await expect(page.getByRole("heading", { name: "About", level: 2 })).toBeFocused();
  await page.goBack();
  await expect(page.getByPlaceholder("ws://your-server:9847/ws")).toHaveValue("ws://draft.test/ws");
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");
});

for (const width of [1120, 900, 640, 320]) {
  for (const theme of ["dark", "light"] as const) {
    test(`layout at ${width}px available width in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: width + 240, height: 1800 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/settings/audio");
      const container = page.locator(".settings-container");
      // Fix the available content width independently of app sidebar behavior.
      await container.evaluate((element, size) => { (element as HTMLElement).style.width = `${size}px`; }, width);
      await expect(page.getByRole("heading", { name: "Audio", level: 2 })).toBeVisible();
      await expect(page.getByLabel("Settings category")).toBeVisible({ visible: width < 900 });
      await expect(page.getByRole("navigation", { name: "Settings categories" })).toBeVisible({ visible: width >= 900 });
      for (const category of ["playback", "audio", "subtitles", "appearance", "connections", "about"]) {
        await page.goto(`/settings/${category}`);
        await container.evaluate((element, size) => { (element as HTMLElement).style.width = `${size}px`; }, width);
        await expect(page.locator(".settings-category-heading h2")).toBeVisible();
        expect(await container.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      await page.goto("/settings/audio");
      await container.evaluate((element, size) => { (element as HTMLElement).style.width = `${size}px`; }, width);
      await expect(page.getByText("Fetching server content…", { exact: true })).toHaveCount(0);
      const screenshotPath = testInfo.outputPath(`settings-${width}-${theme}.png`);
      await container.screenshot({ path: screenshotPath });
      await testInfo.attach(`settings-${width}-${theme}`, { path: screenshotPath, contentType: "image/png" });
    });
  }
}

test("200 percent zoom keeps controls within the Settings width", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 3000 });
  await page.goto("/settings/appearance");
  await page.locator("body").evaluate((element) => { element.style.zoom = "2"; });
  await expect(page.getByLabel("Settings category")).toBeVisible();
  const container = page.locator(".settings-container");
  expect(await container.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByText("Fetching server content…", { exact: true })).toHaveCount(0);
  const screenshotPath = testInfo.outputPath("settings-200-percent.png");
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("settings-200-percent", { path: screenshotPath, contentType: "image/png" });
});

test("failed profile drafts survive categories, retry persists, and revert restores confirmed values", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("prexu_preferences") && sessionStorage.getItem("fail-preferences") === "yes") throw new Error("injected write failure");
      return set.call(this, key, value);
    };
  });
  await page.goto("/settings/playback");
  const quality = page.locator("select").filter({ has: page.locator('option[value="original"]') });
  await expect(quality).toBeEnabled();
  await page.evaluate(() => sessionStorage.setItem("fail-preferences", "yes"));
  await quality.selectOption("720p");
  await expect(page.getByRole("button", { name: "Retry Video Quality" })).toBeVisible();
  await page.getByLabel("Settings category").selectOption("appearance");
  await expect(page.getByText("Some changes are not saved")).toBeVisible();
  await page.getByRole("link", { name: "Video Quality", exact: true }).click();
  await expect(quality).toHaveValue("720p");
  await expect(quality).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("preference-write-failure.png") });
  await page.evaluate(() => sessionStorage.removeItem("fail-preferences"));
  await page.getByRole("button", { name: "Retry Video Quality" }).click();
  await expect(page.locator("#preference-P2")).toHaveText("Saved");
  await expect(quality).toBeFocused();
  await page.reload();
  await expect(quality).toHaveValue("720p");
  await page.evaluate(() => sessionStorage.setItem("fail-preferences", "yes"));
  await quality.selectOption("480p");
  await page.getByRole("button", { name: "Revert Video Quality" }).click();
  await expect(quality).toHaveValue("720p");
  await expect(page.getByText("Some changes are not saved")).toHaveCount(0);
});

test("failed preference reads disable editing until Retry hydrates stored values", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("prexu_preferences_1", JSON.stringify({ playback: { quality: "720p" } }));
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("prexu_preferences") && get.call(sessionStorage, "allow-preference-read") !== "yes") throw new Error("injected read failure");
      return get.call(this, key);
    };
  });
  await page.goto("/settings/playback");
  await expect(page.getByText("Could not load settings")).toBeVisible();
  const quality = page.locator("select").filter({ has: page.locator('option[value="original"]') });
  await expect(quality).toBeDisabled();
  await page.evaluate(() => sessionStorage.setItem("allow-preference-read", "yes"));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(quality).toBeEnabled();
  await expect(quality).toHaveValue("720p");
});

test("failed language and dashboard links focus their own controls", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("prexu_preferences")) throw new Error("injected write failure");
      return set.call(this, key, value);
    };
  });
  await page.goto("/settings/audio");
  const language = page.getByLabel("Preferred Audio Language", { exact: true });
  await language.selectOption("spa");
  await page.getByLabel("Settings category").selectOption("appearance");
  await page.getByRole("link", { name: "Preferred Audio Language", exact: true }).click();
  await expect(language).toBeFocused();
  await expect(language).toHaveValue("spa");
  await page.getByLabel("Settings category").selectOption("appearance");
  const recentShows = page.getByLabel("Recently Added TV Shows", { exact: true });
  await recentShows.uncheck();
  await page.getByLabel("Settings category").selectOption("audio");
  await page.getByRole("link", { name: "Recently Added TV Shows", exact: true }).click();
  await expect(recentShows).toBeFocused();
  await page.getByRole("button", { name: "Revert Recently Added TV Shows" }).click();
  await expect(recentShows).toBeChecked();
  await expect(recentShows).toBeFocused();
});
