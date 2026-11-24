import { test, expect } from "@playwright/test";
import { setupAuthenticatedState } from "./auth-helpers";
import { tauriStubScript, mockPlexData } from "./mock-tauri";

for (const viewport of [{ width: 800, height: 600 }, { width: 1920, height: 1080 }]) {
  for (const collection of [false, true]) {
    test(`${collection ? "collections" : "library"} jump gutter at ${viewport.width}`, async ({ page }, testInfo) => {
      test.setTimeout(60000);
      await page.setViewportSize(viewport);
      await page.addInitScript(tauriStubScript);
      await setupAuthenticatedState(page);
      const items = Array.from({ length: 104 }, (_, i) => ({
        ...mockPlexData.libraryItems.MediaContainer.Metadata[0],
        ratingKey: String(1000 + i),
        title: `${String.fromCharCode(65 + Math.floor(i / 4))} Example ${i}`,
        titleSort: `${String.fromCharCode(65 + Math.floor(i / 4))} Example ${i}`,
        type: collection ? "collection" : "movie",
        childCount: 5,
        viewCount: 1,
      }));
      await page.route("**/library/sections/*/collections*", (route) => route.fulfill({
        json: { MediaContainer: { size: items.length, Metadata: items } },
      }));
      await page.route("**/library/sections/*/all*", (route) => route.fulfill({
        json: { MediaContainer: { size: items.length, totalSize: items.length, offset: 0, Metadata: items } },
      }));
      await page.route("**/library/sections/*/firstCharacter*", (route) => route.fulfill({
        json: { MediaContainer: { Directory: Array.from({ length: 26 }, (_, i) => ({ key: String.fromCharCode(65 + i), size: 4 })) } },
      }));
      await page.goto(collection ? "/collections" : "/library/1");
      const bar = page.getByRole("navigation", { name: "Jump to letter" });
      const sort = collection ? page.locator("#collection-sort") : page.getByRole("combobox", { name: "Sort by" });
      await expect(bar).toBeVisible({ timeout: 30000 });
      await expect(sort).toBeEnabled();
      await expect(page.locator('[data-grid-index="0"]').first()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("layout.png") });
      await testInfo.attach("layout", { path: testInfo.outputPath("layout.png"), contentType: "image/png" });
      const bounds = await bar.boundingBox();
      expect(bounds).not.toBeNull();
      const controls = page.locator('main select, main input, main button, [aria-label="Watched"], [data-grid-index]');
      const contentBounds = await controls.evaluateAll((elements) => elements
        .filter((el) => !el.closest('[aria-label="Jump to letter"]'))
        .map((el) => ({ label: el.getAttribute("aria-label") ?? "content right edge", ...el.getBoundingClientRect().toJSON() })));
      for (const box of contentBounds) {
        if (!box.width || box.bottom <= 0 || box.y >= viewport.height) continue;
        expect(box.right, box.label).toBeLessThanOrEqual(bounds!.x);
      }
      const sortBox = (await sort.boundingBox())!;
      expect(sortBox.x + sortBox.width).toBeLessThanOrEqual(bounds!.x);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await bar.getByRole("button", { name: "Jump to Z", exact: true }).click();
      await expect(page.locator('[data-grid-index="100"]').first()).toBeInViewport();
      await bar.getByRole("button", { name: "Jump to A", exact: true }).click();
      await expect(page.locator('[data-grid-index="0"]').first()).toBeInViewport();
      await sort.selectOption(collection ? "items-desc" : "addedAt:desc");
      await expect(bar).toHaveCount(0);
    });
  }
}
