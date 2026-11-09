import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getPreferences, getUserPreferences, saveUserPreferences, savePreferences, getDefaultPreferences } from "./preferences";

describe("preference storage failure boundaries", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  afterEach(() => vi.unstubAllGlobals());
  it("retains the existing global fallback until a profile is saved", async () => {
    const global = getDefaultPreferences();
    global.appearance.theme = "dark";
    await savePreferences(global);
    expect((await getUserPreferences(42)).appearance.theme).toBe("dark");
    const user = getDefaultPreferences();
    user.appearance.theme = "light";
    await saveUserPreferences(42, user);
    expect((await getUserPreferences(42)).appearance.theme).toBe("light");
    expect((await getPreferences()).appearance.theme).toBe("dark");
  });
  it("rejects corrupt data instead of exposing writable defaults", async () => {
    localStorage.setItem("prexu_preferences", "{");
    await expect(getPreferences()).rejects.toThrow();
    await expect(getUserPreferences(42)).rejects.toThrow();
    expect(localStorage.getItem("prexu_preferences")).toBe("{");
  });
  it("rejects denied reads and does not fall back to global on a failed profile read", async () => {
    const get = vi.fn(() => { throw new Error("read denied"); });
    // Storage is a proxy in jsdom on Node 22; spying on the instance can
    // silently leave its native method intact. Replace the global boundary.
    vi.stubGlobal("localStorage", { getItem: get });
    await expect(getUserPreferences(42)).rejects.toThrow("read denied");
    expect(get).toHaveBeenCalledTimes(1);
    await expect(getPreferences()).rejects.toThrow("read denied");
  });
});
