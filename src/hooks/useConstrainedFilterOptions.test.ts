import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useConstrainedFilterOptions, type ServerFilterOptions } from "./useConstrainedFilterOptions";
import type { FacetSourceItem } from "../utils/derive-filter-facets";
import type { LibraryFilters } from "../types/library";

vi.mock("../services/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

const serverOptions: ServerFilterOptions = {
  genres: [
    { key: "documentary", title: "Documentary" },
    { key: "comedy", title: "Comedy" },
    { key: "drama", title: "Drama" },
  ],
  years: [
    { key: "2020", title: "2020" },
    { key: "1999", title: "1999" },
    { key: "1985", title: "1985" },
  ],
  contentRatings: [
    { key: "PG", title: "PG" },
    { key: "PG-13", title: "PG-13" },
    { key: "R", title: "R" },
  ],
  resolutions: [
    { key: "1080", title: "1080p" },
    { key: "4k", title: "4K" },
    { key: "720", title: "720p" },
  ],
};

// Only years 1999 and 2020, only Documentary genre, PG-13 rating, 1080 res —
// simulates a genre=Documentary filtered result set that finished loading.
const loadedItems: FacetSourceItem[] = [
  {
    year: 1999,
    contentRating: "PG-13",
    Media: [{ videoResolution: "1080" }],
    Genre: [{ tag: "Documentary" }],
  },
  {
    year: 2020,
    contentRating: "PG-13",
    Media: [{ videoResolution: "1080" }],
    Genre: [{ tag: "Documentary" }],
  },
];

function baseParams(overrides: Partial<Parameters<typeof useConstrainedFilterOptions>[0]> = {}) {
  return {
    serverOptions,
    items: loadedItems,
    hasActiveFilters: true,
    isFillComplete: true,
    filters: {} as LibraryFilters,
    ...overrides,
  };
}

describe("useConstrainedFilterOptions", () => {
  it("returns server options unchanged when no filters are active", () => {
    const { result } = renderHook(() =>
      useConstrainedFilterOptions(baseParams({ hasActiveFilters: false }))
    );
    expect(result.current).toEqual(serverOptions);
  });

  it("returns server options unchanged while the fill is still in progress, even with filters active", () => {
    const { result } = renderHook(() =>
      useConstrainedFilterOptions(
        baseParams({ hasActiveFilters: true, isFillComplete: false, filters: { genre: "documentary" } })
      )
    );
    expect(result.current).toEqual(serverOptions);
  });

  it("constrains dropdowns without an active selection once filters are active and the fill is complete", () => {
    const { result } = renderHook(() =>
      useConstrainedFilterOptions(
        baseParams({ filters: { genre: "documentary" } })
      )
    );

    // Genre has an active selection -> full list preserved.
    expect(result.current.genres).toEqual(serverOptions.genres);

    // Year, contentRating, resolution have no active selection -> narrowed
    // to only what's present in the loaded (Documentary-filtered) items.
    expect(result.current.years.map((y) => y.key)).toEqual(["2020", "1999"]);
    expect(result.current.contentRatings.map((c) => c.key)).toEqual(["PG-13"]);
    expect(result.current.resolutions.map((r) => r.key)).toEqual(["1080"]);
  });

  it("keeps the full list for a dropdown that has its own active selection", () => {
    const { result } = renderHook(() =>
      useConstrainedFilterOptions(
        baseParams({ filters: { genre: "documentary", contentRating: "PG-13" } })
      )
    );

    // contentRating has an active selection -> full list preserved even
    // though the derived facet would also only contain PG-13.
    expect(result.current.contentRatings).toEqual(serverOptions.contentRatings);
  });

  it("treats yearMin/yearMax as one unit: either bound set keeps the full year list", () => {
    const { result } = renderHook(() =>
      useConstrainedFilterOptions(
        baseParams({ filters: { genre: "documentary", yearMin: "1999" } })
      )
    );
    expect(result.current.years).toEqual(serverOptions.years);
  });

  it("narrows the genre dropdown (case-insensitive tag/title match) when genre itself is unset", () => {
    const items: FacetSourceItem[] = [{ year: 1999, Genre: [{ tag: "documentary" }] }];
    const { result } = renderHook(() =>
      useConstrainedFilterOptions(baseParams({ items, filters: { yearMin: "1999", yearMax: "1999" } }))
    );
    expect(result.current.genres.map((g) => g.key)).toEqual(["documentary"]);
  });

  it("returns an empty option list for a facet with no matching values in the loaded set", () => {
    const items: FacetSourceItem[] = [{ year: 1999 }]; // no resolution info at all
    const { result } = renderHook(() =>
      useConstrainedFilterOptions(baseParams({ items, filters: { genre: "documentary" } }))
    );
    expect(result.current.resolutions).toEqual([]);
  });
});
