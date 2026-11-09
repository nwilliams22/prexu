import { test, expect } from "@playwright/test";
import { tauriStubScript } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

test("keyboard search restores URL history and focuses enabled and disabled controls", async ({ page }) => {
  await page.goto("/settings/subtitles");
  await page.getByLabel("Default Subtitles", { exact: true }).selectOption("off");
  const search = page.getByRole("searchbox", { name: "Search settings" });
  await search.fill("subtitle language");
  await expect(page).toHaveURL(/q=subtitle\+language/);
  await expect(page.getByRole("status").filter({ hasText: "1 setting found" })).toBeVisible();
  const result = page.getByRole("link", { name: /Preferred Subtitle Language.*Subtitles/ });
  await result.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#L2-label")).toBeFocused();
  await expect(page.getByLabel("Preferred Subtitle Language")).toBeDisabled();
  await expect(page.getByText("Turn on default subtitles to choose a preferred language.")).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue("subtitle language");
  await expect(result).toBeVisible();
  await search.fill("audio language");
  await page.getByRole("link", { name: /Preferred Audio Language.*Audio/ }).click();
  await expect(page.getByLabel("Preferred Audio Language")).toBeFocused();
  await page.goBack();
  await expect(search).toHaveValue("audio language");
  await search.press("Escape");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(page).toHaveURL(/\/settings\/subtitles$/);
});

test("static search excludes private data and admin controls for viewers at 320px", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("active_user", JSON.stringify({ id: 2, title: "Private Viewer", isAdmin: false })));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/settings/playback?q=restrictions");
  await expect(page.getByText("No settings match ‘restrictions’")).toBeVisible();
  const search = page.getByRole("searchbox");
  await search.fill("Private Viewer");
  await expect(page.getByText("No settings match ‘Private Viewer’")).toBeVisible();
  await page.locator(".settings-container").getByRole("button", { name: "Clear search" }).click();
  await expect(search).toBeFocused();
  await search.fill("volume");
  await expect(page.getByRole("link", { name: /Invite notification volume/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("search-narrow.png") });
});
