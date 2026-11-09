import { test, expect } from "@playwright/test";
import { tauriStubScript } from "./mock-tauri";
import { setupAuthenticatedState } from "./auth-helpers";
const users = [{ id: 1, title: "Admin", admin: true }, { id: 2, title: "Child", admin: false, protected: true }, { id: 3, title: "Teen", admin: false }];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(tauriStubScript);
  await setupAuthenticatedState(page);
  await page.route("**/home/users", (route) => route.fulfill({ json: { users } }));
});

test("parental changes require confirmation, persist, and recover from failed writes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 600, height: 1000 });
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("prexu_parental_") && sessionStorage.getItem("fail-parental") === "yes") throw new Error("injected failure");
      return set.call(this, key, value);
    };
  });
  await page.goto("/settings/parental-controls");
  await page.getByRole("button", { name: "Edit Child" }).click();
  await expect(page.getByLabel("Maximum Allowed Rating")).toBeDisabled();
  await page.getByLabel("Enable content restrictions").check();
  await page.getByLabel("Maximum Allowed Rating").selectOption("PG");
  await page.getByRole("button", { name: "Edit Teen" }).click();
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Maximum Allowed Rating")).toHaveValue("PG");
  await page.evaluate(() => sessionStorage.setItem("fail-parental", "yes"));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".settings-container").getByRole("alert")).toContainText("Could not save restrictions");
  await page.evaluate(() => sessionStorage.removeItem("fail-parental"));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Restrictions updated for Child")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Child" })).toBeFocused();
  await page.reload();
  await expect(page.getByText("Maximum rating: PG — Parental Guidance")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("parental-confirmed.png") });
});

test("parental loading, failed reads, retry and empty states are distinct", async ({ page }) => {
  let fail = true;
  await page.route("**/home/users", (route) => route.fulfill({ status: fail ? 500 : 200, json: { users: [] } }));
  await page.goto("/settings/parental-controls");
  await expect(page.getByText("Could not load parental controls.")).toBeVisible();
  await expect(page.getByText("No restrictions")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("No managed users available")).toBeVisible();
});

test("non-admin direct route shows no managed data", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("active_user", JSON.stringify({ id: 2, title: "Viewer", isAdmin: false })));
  await page.goto("/settings/parental-controls");
  await expect(page.getByText("Parental controls are available to administrators")).toBeVisible();
  await expect(page.getByText("Child", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to Playback" })).toBeVisible();
});

test("relay validation, failed writes, trim and sanitized display at 320px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "prexu_relay_url" && sessionStorage.getItem("fail-relay") === "yes") throw new Error("injected failure");
      return set.call(this, key, value);
    };
  });
  await page.goto("/settings/connections");
  await page.getByRole("button", { name: "Use custom relay URL" }).click();
  const address = page.getByLabel("Custom relay URL", { exact: true });
  await address.fill("https://relay.test");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await address.fill("  wss://user:private@relay.test/path?token=secret  ");
  await page.evaluate(() => sessionStorage.setItem("fail-relay", "yes"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".settings-container").getByRole("alert")).toContainText("Could not save relay address");
  await page.evaluate(() => sessionStorage.removeItem("fail-relay"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Relay address saved")).toBeVisible();
  await expect(page.locator("#relay-connection")).not.toContainText("secret");
  await expect(page.locator("#relay-connection")).not.toContainText("private");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("prexu_relay_url")!))).toBe("wss://user:private@relay.test/path?token=secret");
  const container = page.locator(".settings-container");
  expect(await container.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("connections-320.png") });
  await page.getByRole("button", { name: "Reset to auto-detect" }).click();
  await expect(page.getByText("Automatic", { exact: true })).toBeVisible();
});

test("custom audio decodes before selection and previews only by keyboard action", async ({ page }) => {
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      sessionStorage.setItem("custom-previews", String(Number(sessionStorage.getItem("custom-previews") ?? "0") + 1));
      return original.call(this);
    };
  });
  await page.goto("/settings/connections");
  const fileInput = page.getByLabel("Choose audio file");
  await fileInput.setInputFiles({ name: "bad.wav", mimeType: "audio/wav", buffer: Buffer.from("invalid audio") });
  await expect(page.locator(".settings-container").getByRole("alert")).toContainText("This audio file could not be loaded");
  await expect(page.getByRole("radio", { name: "Chime", exact: true })).toBeChecked();
  const wav = Buffer.alloc(44 + 1600);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(1600, 40);
  await fileInput.setInputFiles({ name: "valid.wav", mimeType: "audio/wav", buffer: wav });
  await expect(page.getByRole("radio", { name: "Custom", exact: true })).toBeChecked();
  const preview = page.getByRole("button", { name: "Preview sound" });
  await expect(preview).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem("custom-previews"))).toBeNull();
  await preview.focus(); await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("custom-previews"))).toBe("1");
  await page.getByLabel("Invite notification volume", { exact: true }).fill("0");
  await expect(preview).toBeDisabled();
  await expect(page.getByText("Increase volume to preview.")).toBeVisible();
});
