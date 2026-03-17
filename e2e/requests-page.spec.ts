import { test, expect } from "@playwright/test";
import { tauriStubScript } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
});

test.describe("Requests: admin view", () => {
  test("renders Content Requests heading for admin", async ({ page }) => {
    await page.goto("/requests");
    // Use getByRole to avoid matching other "Content Requests" text on the page
    await expect(page.getByRole("heading", { name: "Content Requests" })).toBeVisible();
  });

  test("shows filter tabs", async ({ page }) => {
    await page.goto("/requests");
    await expect(page.getByText("All")).toBeVisible();
    await expect(page.getByText("Pending")).toBeVisible();
    await expect(page.getByText("Approved")).toBeVisible();
    await expect(page.getByText("Declined")).toBeVisible();
  });

  test("page loads without errors", async ({ page }) => {
    await page.goto("/requests");
    // Verify the page rendered (no crash)
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Requests: non-admin view", () => {
  test.beforeEach(async ({ page }) => {
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
        })
      );
    });
  });

  test("renders My Requests heading for non-admin", async ({ page }) => {
    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: "My Requests" })).toBeVisible();
  });

  test("shows request form button for non-admin", async ({ page }) => {
    await page.goto("/requests");
    await expect(page.getByText(/Request Something/)).toBeVisible();
  });
});

test.describe("Requests: responsive", () => {
  test("renders on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/requests");
    await expect(page.locator("body")).toBeVisible();
  });
});
