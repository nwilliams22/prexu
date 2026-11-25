import { describe, expect, it } from "vitest";
import type { DownloadItem } from "../../types/downloads";
import { downloadSize, groupSeasons, groupShows, watchedDownloads } from "./groups";

function episode(ratingKey: string, overrides: Partial<DownloadItem> = {}): DownloadItem {
  return { ratingKey, title: ratingKey, subtitle: "", type: "episode", thumb: "", partKey: "", fileName: "", fileSize: 1024, bytesDownloaded: 1024, serverUri: "qa", status: "complete", grandparentTitle: "QA show", parentIndex: 1, index: 1, ...overrides };
}

describe("download groups", () => {
  it("keeps shows and servers separate without merging unknown shows", () => {
    const groups = groupShows([episode("a"), episode("b", { parentIndex: 2 }), episode("c", { grandparentTitle: "Other" }), episode("d", { serverUri: "other" }), episode("e", { grandparentTitle: undefined }), episode("f", { grandparentTitle: undefined })]);
    expect(groups).toHaveLength(5);
    expect(groups.find((group) => group.items.length === 2)?.items.map((item) => item.ratingKey)).toEqual(["a", "b"]);
  });
  it("sorts seasons and episodes numerically, preserving specials and missing metadata", () => {
    const groups = groupSeasons([episode("ten", { parentIndex: 10 }), episode("two", { parentIndex: 2, index: 2 }), episode("one", { parentIndex: 2, index: 1 }), episode("unknown", { parentIndex: undefined }), episode("special", { parentIndex: 0 })]);
    expect(groups.map((group) => group.title)).toEqual(["Specials", "Season 2", "Season 10", "Unknown season"]);
    expect(groups[1].items.map((item) => item.ratingKey)).toEqual(["one", "two"]);
  });
  it("totals completed files and actual partial bytes rather than expected sizes", () => {
    expect(downloadSize([episode("a"), episode("b", { status: "error", bytesDownloaded: 100 }), episode("c", { status: "queued", bytesDownloaded: 0 })])).toBe(1124);
    expect(downloadSize([])).toBe(0);
  });
  it("deletes only complete downloads with confirmed watched state", () => {
    expect(watchedDownloads([episode("watched"), episode("unwatched"), episode("queued", { status: "queued" }), episode("failed", { status: "error" })], new Set(["watched", "queued", "failed", "not-downloaded"])).map((item) => item.ratingKey)).toEqual(["watched"]);
  });
});
