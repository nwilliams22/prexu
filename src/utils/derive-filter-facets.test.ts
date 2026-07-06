import { describe, it, expect } from "vitest";
import { deriveFilterFacets, type FacetSourceItem } from "./derive-filter-facets";

describe("deriveFilterFacets", () => {
  it("returns empty facets for an empty store", () => {
    expect(deriveFilterFacets([])).toEqual({
      years: [],
      contentRatings: [],
      resolutions: [],
      genres: [],
    });
  });

  it("skips unfetched (undefined) slots in a sparse store", () => {
    const items: (FacetSourceItem | undefined)[] = [
      { year: 1999 },
      undefined,
      undefined,
      { year: 2001 },
    ];
    const facets = deriveFilterFacets(items);
    expect(facets.years).toEqual(["1999", "2001"]);
  });

  it("dedupes and sorts years numerically ascending", () => {
    const items: FacetSourceItem[] = [
      { year: 2010 },
      { year: 1999 },
      { year: 2010 },
      { year: 2001 },
    ];
    expect(deriveFilterFacets(items).years).toEqual(["1999", "2001", "2010"]);
  });

  it("dedupes and sorts content ratings alphabetically", () => {
    const items: FacetSourceItem[] = [
      { contentRating: "R" },
      { contentRating: "PG-13" },
      { contentRating: "R" },
      { contentRating: "G" },
    ];
    expect(deriveFilterFacets(items).contentRatings).toEqual(["G", "PG-13", "R"]);
  });

  it("dedupes and sorts resolutions alphabetically, reading the first Media entry", () => {
    const items: FacetSourceItem[] = [
      { Media: [{ videoResolution: "1080" }] },
      { Media: [{ videoResolution: "4k" }] },
      { Media: [{ videoResolution: "1080" }] },
      { Media: [{ videoResolution: "720" }] },
    ];
    expect(deriveFilterFacets(items).resolutions).toEqual(["1080", "4k", "720"]);
  });

  it("derives genres from the full Genre tag array on each item, deduping across items", () => {
    const items: FacetSourceItem[] = [
      { Genre: [{ tag: "Documentary" }, { tag: "History" }] },
      { Genre: [{ tag: "Documentary" }] },
      { Genre: [{ tag: "Comedy" }] },
    ];
    expect(deriveFilterFacets(items).genres).toEqual(["Comedy", "Documentary", "History"]);
  });

  it("handles items missing every optional facet field without crashing", () => {
    const items: FacetSourceItem[] = [{}, {}];
    expect(deriveFilterFacets(items)).toEqual({
      years: [],
      contentRatings: [],
      resolutions: [],
      genres: [],
    });
  });

  it("handles an item with an empty Genre array", () => {
    const items: FacetSourceItem[] = [{ Genre: [] }, { Genre: [{ tag: "Comedy" }] }];
    expect(deriveFilterFacets(items).genres).toEqual(["Comedy"]);
  });

  it("handles an item with an empty Media array (no videoResolution to read)", () => {
    const items: FacetSourceItem[] = [{ Media: [] }, { Media: [{ videoResolution: "1080" }] }];
    expect(deriveFilterFacets(items).resolutions).toEqual(["1080"]);
  });

  it("computes all four facets together from a mixed, sparse store", () => {
    const items: (FacetSourceItem | undefined)[] = [
      {
        year: 2015,
        contentRating: "PG-13",
        Media: [{ videoResolution: "1080" }],
        Genre: [{ tag: "Documentary" }],
      },
      undefined,
      {
        year: 2015,
        contentRating: "R",
        Media: [{ videoResolution: "4k" }],
        Genre: [{ tag: "Documentary" }, { tag: "Comedy" }],
      },
    ];
    expect(deriveFilterFacets(items)).toEqual({
      years: ["2015"],
      contentRatings: ["PG-13", "R"],
      resolutions: ["1080", "4k"],
      genres: ["Comedy", "Documentary"],
    });
  });
});
