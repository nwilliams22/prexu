import { describe, it, expect } from "vitest";
import { searchSettings, SETTINGS_SEARCH_ENTRIES } from "./settingsSearch";
import { preferenceRows } from "./PreferenceSaveStatus";
const all = { isAdmin: true, nativePlayer: true };
const ids = (query: string, capabilities = all) => searchSettings(query, capabilities).map((item) => item.id);

describe("Settings search inventory", () => {
  it("covers every profile row plus device and parental inventory IDs exactly once", () => {
    const inventory = SETTINGS_SEARCH_ENTRIES.map((item) => item.id);
    expect(new Set(inventory).size).toBe(inventory.length);
    for (const [id] of Object.values(preferenceRows)) expect(inventory).toContain(id);
    for (const id of ["N1", "N2", "N3", "C1", "C2"]) expect(inventory).toContain(id);
  });
  it("matches all words case insensitively with deterministic exact/prefix/category order", () => {
    expect(ids("  AUDIO   LANGUAGE ")).toEqual(["P7"]);
    expect(ids("theme")[0]).toBe("V1");
    expect(ids("subtitle").slice(0, 2)).toEqual(["subtitle-preview", "L3"]);
    expect(ids("language")).toEqual(["P7", "L2"]);
    expect(ids("captions")).toEqual(["L1", "L2", "subtitle-preview", "L3", "S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
    expect(ids("volume")).toEqual(expect.arrayContaining(["P7", "A1", "A2", "A3", "A4", "N2"]));
    expect(ids("server")).toEqual(expect.arrayContaining(["N1", "N2", "N3"]));
    expect(ids("restrictions")).toEqual(["C1", "C2"]);
    expect(ids("volumee")).toEqual([]);
    expect(ids("   ")).toEqual([]);
  });
  it("filters permissions and platform capability and indexes static About actions", () => {
    expect(ids("player engine", { isAdmin: false, nativePlayer: false })).toEqual([]);
    expect(ids("restrictions", { isAdmin: false, nativePlayer: true })).toEqual([]);
    expect(ids("content search", { isAdmin: false, nativePlayer: true })).toEqual([]);
    expect(ids("github")).toEqual(["about-github"]);
    expect(ids("version")).toEqual(["about-version"]);
    expect(ids("private-profile-name")).toEqual([]);
  });
});
