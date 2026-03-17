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
    ).toBeVisible();
  });

  test("shows Playback section", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Playback" })).toBeVisible();
  });

  test("shows Appearance section", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Appearance")).toBeVisible();
  });

  test("shows Watch Together section", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Watch Together" })).toBeVisible();
  });

  test("shows About section with version", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText(/v\d+\.\d+\.\d+/)).toBeVisible();
  });

  test("shows Content Requests section for admin users", async ({ page }) => {
    await page.goto("/settings");
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
    await expect(page.getByText("Content Requests")).not.toBeVisible();
  });
});
