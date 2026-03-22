import { describe, it, expect } from "vitest";
import { filterSubtitleTracks } from "./subtitle-filter";
import type { PlexStream } from "../types/library";

const tracks: PlexStream[] = [
  { id: 1, streamType: 3, codec: "srt", index: 0, displayTitle: "English (SRT)", language: "English", languageCode: "eng" },
  { id: 2, streamType: 3, codec: "ass", index: 1, displayTitle: "English SDH (ASS)", language: "English", languageCode: "eng", hearingImpaired: true },
  { id: 3, streamType: 3, codec: "srt", index: 2, displayTitle: "Spanish (SRT)", language: "Spanish", languageCode: "spa" },
  { id: 4, streamType: 3, codec: "pgs", index: 3, displayTitle: "French (PGS)", language: "French", languageCode: "fre" },
] as PlexStream[];

describe("filterSubtitleTracks", () => {
  it("returns all tracks when no filters", () => {
    expect(filterSubtitleTracks(tracks)).toHaveLength(4);
  });

  it("filters by text query on displayTitle", () => {
    expect(filterSubtitleTracks(tracks, "spanish")).toHaveLength(1);
    expect(filterSubtitleTracks(tracks, "spanish")[0].id).toBe(3);
  });

  it("filters by text query on codec", () => {
    expect(filterSubtitleTracks(tracks, "pgs")).toHaveLength(1);
    expect(filterSubtitleTracks(tracks, "pgs")[0].id).toBe(4);
  });

  it("filters by language code", () => {
    expect(filterSubtitleTracks(tracks, undefined, "eng")).toHaveLength(2);
  });

  it("filters by hearing impaired", () => {
    expect(filterSubtitleTracks(tracks, undefined, undefined, true)).toHaveLength(1);
    expect(filterSubtitleTracks(tracks, undefined, undefined, true)[0].id).toBe(2);
  });

  it("combines multiple filters", () => {
    expect(filterSubtitleTracks(tracks, "srt", "eng")).toHaveLength(1);
    expect(filterSubtitleTracks(tracks, "srt", "eng")[0].id).toBe(1);
  });

  it("returns empty for no matches", () => {
    expect(filterSubtitleTracks(tracks, "japanese")).toHaveLength(0);
  });
});
