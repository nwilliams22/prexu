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

  test("shows Relay connection section", async ({ page }) => {
    await page.goto("/settings/connections");
    await expect(page.getByRole("heading", { name: "Relay connection" })).toBeVisible();
  });

  test("shows About section with version", async ({ page }) => {
    await page.goto("/settings/about");
    await expect(page.getByText(/v\d+\.\d+\.\d+/)).toBeVisible();
  });

  test("shows Content search section for admin users", async ({ page }) => {
    await page.goto("/settings/about");
    await expect(page.getByRole("heading", { name: "Content search", exact: true })).toBeVisible();
  });

  test("hides Content search for non-admin users", async ({ page }) => {
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
    await expect(page.getByRole("heading", { name: "Content search", exact: true })).not.toBeVisible();
  });
});

test("dirty relay navigation requires discard and browser Back restores the category", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/playback$/);
  const category = page.getByLabel("Settings category");
  await category.selectOption("connections");
  await page.getByRole("button", { name: "Use custom relay URL" }).click();
  await page.getByLabel("Custom relay URL", { exact: true }).fill("ws://draft.test/ws");
  await category.selectOption("about");
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Custom relay URL", { exact: true })).toHaveValue("ws://draft.test/ws");
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/settings\/connections$/);
  await category.selectOption("about");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("heading", { name: "About", level: 2 })).toBeFocused();
  await page.goBack();
  await expect(page.getByRole("button", { name: "Use custom relay URL" })).toBeVisible();
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

test("migrated profile controls preserve subtitle choices and preview size across reload", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 600, height: 1100 });
  await page.goto("/settings/subtitles");
  await expect(page.getByText("Preferences for TestUser on this device.")).toBeVisible();
  await page.getByLabel("Preferred Subtitle Language", { exact: true }).selectOption("fra");
  const size = page.getByRole("slider", { name: "Subtitle Size", exact: true });
  await size.focus();
  await page.keyboard.press("End");
  await expect(size).toHaveValue("200");
  await expect(page.getByText("Sample subtitle text", { exact: true })).toHaveCSS("font-size", "35.2px");
  await page.getByLabel("Default Subtitles", { exact: true }).selectOption("off");
  await expect(page.getByLabel("Preferred Subtitle Language", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Preferred Subtitle Language", { exact: true })).toHaveValue("fra");
  await expect(page.getByLabel("Font", { exact: true })).toBeEnabled();
  await page.getByRole("slider", { name: "Background Opacity", exact: true }).focus();
  await page.keyboard.press("Home");
  await expect(page.getByLabel("Background Color", { exact: true })).toBeVisible();
  await expect(page.locator("#preference-S4")).toHaveText("Saved");
  await page.reload();
  await expect(size).toHaveValue("200");
  await expect(page.getByLabel("Preferred Subtitle Language", { exact: true })).toHaveValue("fra");
  await expect(page.getByRole("slider", { name: "Background Opacity", exact: true })).toHaveValue("0");
  const shot = testInfo.outputPath("subtitles-migrated.png");
  await page.locator(".settings-container").screenshot({ path: shot });
  await testInfo.attach("subtitles-migrated", { path: shot, contentType: "image/png" });
});
