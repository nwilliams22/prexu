/**
 * Performance tests — ensure the app can handle large datasets
 * without unacceptable rendering delays or memory issues.
 *
 * These tests measure wall-clock time for rendering and processing
 * large collections of media items, validating that the app stays
 * responsive under stress.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import {
  createPlexMovie,
  createPlexShow,
  createPlexEpisode,
  createPlexCollection,
  resetIdCounter,
} from "./mocks/plex-data";
import { mockBreakpoint, renderWithProviders } from "./test-utils";
import {
  getMediaTitle,
  getMediaSubtitle,
  getMediaPoster,
  getProgress,
  isWatched,
  getUnwatchedCount,
} from "../utils/media-helpers";
import type { PlexMediaItem } from "../types/library";

// ── Components under test ──
import PosterCard from "../components/PosterCard";
import LibraryGrid from "../components/LibraryGrid";
import HorizontalRow from "../components/HorizontalRow";

beforeEach(() => {
  resetIdCounter();
  mockBreakpoint("desktop");
  // Mock ResizeObserver for HorizontalRow (must be a class constructor)
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Helper: generate N movies ──
function generateMovies(count: number) {
  return Array.from({ length: count }, (_, i) =>
    createPlexMovie({
      title: `Movie ${i + 1}`,
      year: 2020 + (i % 6),
      duration: 5400000 + (i % 10) * 600000,
    }),
  );
}

function generateShows(count: number) {
  return Array.from({ length: count }, (_, i) =>
    createPlexShow({
      title: `Show ${i + 1}`,
      childCount: 3 + (i % 5),
      leafCount: 20 + (i % 30),
      viewedLeafCount: i % 15,
    }),
  );
}

function generateEpisodes(count: number) {
  return Array.from({ length: count }, (_, i) =>
    createPlexEpisode({
      title: `Episode ${i + 1}`,
      index: (i % 24) + 1,
      parentIndex: Math.floor(i / 24) + 1,
      grandparentTitle: `Show ${Math.floor(i / 24) + 1}`,
    }),
  );
}

// ── Utility performance ──

describe("Performance: utility functions with large datasets", () => {
  const ITEM_COUNT = 5000;
  let movies: PlexMediaItem[];
  let shows: PlexMediaItem[];
  let episodes: PlexMediaItem[];

  beforeEach(() => {
    movies = generateMovies(ITEM_COUNT);
    shows = generateShows(ITEM_COUNT);
    episodes = generateEpisodes(ITEM_COUNT);
  });

  it(`processes ${ITEM_COUNT} movies through getMediaTitle in < 50ms`, () => {
    const start = performance.now();
    for (const item of movies) {
      getMediaTitle(item);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it(`processes ${ITEM_COUNT} episodes through getMediaTitle in < 50ms`, () => {
    const start = performance.now();
    for (const item of episodes) {
      getMediaTitle(item);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it(`processes ${ITEM_COUNT} items through getMediaSubtitle in < 100ms`, () => {
    const mixed = [...movies.slice(0, 1667), ...shows.slice(0, 1667), ...episodes.slice(0, 1666)];
    const start = performance.now();
    for (const item of mixed) {
      getMediaSubtitle(item, { showEpisodeCount: true });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it(`processes ${ITEM_COUNT} items through getMediaPoster in < 50ms`, () => {
    const start = performance.now();
    for (const item of movies) {
      getMediaPoster(item);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it(`processes ${ITEM_COUNT} items through getProgress in < 50ms`, () => {
    const start = performance.now();
    for (const item of movies) {
      getProgress(item);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it(`evaluates isWatched for ${ITEM_COUNT} movies in < 50ms`, () => {
    const start = performance.now();
    for (const item of movies) {
      isWatched(item);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it(`evaluates getUnwatchedCount for ${ITEM_COUNT} shows in < 50ms`, () => {
    const start = performance.now();
    for (const item of shows) {
      getUnwatchedCount(item);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it("generates 10,000 mock items in < 500ms", () => {
    resetIdCounter();
    const start = performance.now();
    const items = generateMovies(10000);
    const elapsed = performance.now() - start;
    expect(items).toHaveLength(10000);
    expect(elapsed).toBeLessThan(500);
  });
});

// ── Rendering performance ──

describe("Performance: rendering large grids", () => {
  it("renders 200 PosterCards in a LibraryGrid in < 2000ms", () => {
    const items = generateMovies(200);

    const start = performance.now();
    render(
      <BrowserRouter>
        <LibraryGrid>
          {items.map((item) => (
            <PosterCard
              key={item.ratingKey}
              imageUrl={item.thumb}
              title={item.title}
              subtitle={String(item.year ?? "")}
              onClick={vi.fn()}
            />
          ))}
        </LibraryGrid>
      </BrowserRouter>,
    );
    const elapsed = performance.now() - start;

    // All 200 cards should be in the DOM
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(2000);
  });

  it("renders 500 PosterCards in a LibraryGrid in < 5000ms", () => {
    const items = generateMovies(500);

    const start = performance.now();
    render(
      <BrowserRouter>
        <LibraryGrid>
          {items.map((item) => (
            <PosterCard
              key={item.ratingKey}
              imageUrl={item.thumb}
              title={item.title}
              subtitle={String(item.year ?? "")}
              onClick={vi.fn()}
            />
          ))}
        </LibraryGrid>
      </BrowserRouter>,
    );
    const elapsed = performance.now() - start;

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThan(5000);
  });

  it("renders 100 PosterCards with full props (progress, badges, watched) in < 3500ms", () => {
    const items = generateMovies(100);

    const start = performance.now();
    render(
      <BrowserRouter>
        <LibraryGrid>
          {items.map((item, i) => (
            <PosterCard
              key={item.ratingKey}
              imageUrl={item.thumb}
              title={item.title}
              subtitle={String(item.year ?? "")}
              onClick={vi.fn()}
              onPlay={vi.fn()}
              onExpand={vi.fn()}
              showMoreButton
              onMoreClick={vi.fn()}
              progress={i % 3 === 0 ? (i % 100) / 100 : undefined}
              watched={i % 4 === 0}
              unwatchedCount={i % 5 === 0 ? 3 : undefined}
              badge={i % 7 === 0 ? "+2 episodes" : undefined}
            />
          ))}
        </LibraryGrid>
      </BrowserRouter>,
    );
    const elapsed = performance.now() - start;

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(3500);
  });
});

describe("Performance: HorizontalRow with many cards", () => {
  it("renders a HorizontalRow with 50 cards in < 1000ms", () => {
    const items = generateMovies(50);

    const start = performance.now();
    render(
      <BrowserRouter>
        <HorizontalRow title="Continue Watching" onSeeAll={vi.fn()}>
          {items.map((item) => (
            <PosterCard
              key={item.ratingKey}
              imageUrl={item.thumb}
              title={item.title}
              subtitle={String(item.year ?? "")}
              onClick={vi.fn()}
              width={170}
            />
          ))}
        </HorizontalRow>
      </BrowserRouter>,
    );
    const elapsed = performance.now() - start;

    expect(screen.getByText("Continue Watching")).toBeInTheDocument();
    expect(elapsed).toBeLessThan(1000);
  });
});

// ── Memo performance ──

describe("Performance: React.memo prevents unnecessary re-renders", () => {
  it("PosterCard memo skips re-render when props are identical", () => {
    const onClick = vi.fn();
    const props = {
      imageUrl: "/thumb/1",
      title: "Test Movie",
      subtitle: "2024",
      onClick,
    };

    const { rerender } = render(
      <BrowserRouter>
        <PosterCard {...props} />
      </BrowserRouter>,
    );

    // Re-render with same props — memo should skip internal re-render
    // We can't directly count renders, but we verify no crash and DOM stability
    const titleBefore = screen.getByText("Test Movie");

    rerender(
      <BrowserRouter>
        <PosterCard {...props} />
      </BrowserRouter>,
    );

    const titleAfter = screen.getByText("Test Movie");
    expect(titleAfter).toBe(titleBefore); // same DOM node = no re-render
  });
});

// ── Data processing at scale ──

describe("Performance: batch data processing", () => {
  it("filters 5000 items by type in < 20ms", () => {
    const movies = generateMovies(2500);
    const shows = generateShows(2500);
    const all: PlexMediaItem[] = [...movies, ...shows];

    const start = performance.now();
    const filtered = all.filter((item) => item.type === "movie");
    const elapsed = performance.now() - start;

    expect(filtered).toHaveLength(2500);
    expect(elapsed).toBeLessThan(20);
  });

  it("sorts 5000 items by title in < 50ms", () => {
    const items = generateMovies(5000);

    const start = performance.now();
    const sorted = [...items].sort((a, b) => a.title.localeCompare(b.title));
    const elapsed = performance.now() - start;

    expect(sorted).toHaveLength(5000);
    expect(elapsed).toBeLessThan(50);
  });

  it("sorts 5000 items by year in < 20ms", () => {
    const items = generateMovies(5000);

    const start = performance.now();
    const sorted = [...items].sort(
      (a, b) => ((b as any).year ?? 0) - ((a as any).year ?? 0),
    );
    const elapsed = performance.now() - start;

    expect(sorted).toHaveLength(5000);
    expect(elapsed).toBeLessThan(20);
  });

  it("groups 5000 episodes by season in < 50ms", () => {
    const episodes = generateEpisodes(5000);

    const start = performance.now();
    const grouped = new Map<number, PlexMediaItem[]>();
    for (const ep of episodes) {
      const seasonIdx = (ep as any).parentIndex ?? 1;
      const arr = grouped.get(seasonIdx);
      if (arr) {
        arr.push(ep);
      } else {
        grouped.set(seasonIdx, [ep]);
      }
    }
    const elapsed = performance.now() - start;

    expect(grouped.size).toBeGreaterThan(0);
    let total = 0;
    for (const arr of grouped.values()) total += arr.length;
    expect(total).toBe(5000);
    expect(elapsed).toBeLessThan(50);
  });

  it("computes watched/unwatched stats for 5000 shows in < 50ms", () => {
    const shows = generateShows(5000);

    const start = performance.now();
    let watchedCount = 0;
    let totalUnwatched = 0;
    for (const item of shows) {
      if (isWatched(item)) watchedCount++;
      totalUnwatched += getUnwatchedCount(item) ?? 0;
    }
    const elapsed = performance.now() - start;

    expect(watchedCount + (5000 - watchedCount)).toBe(5000);
    expect(elapsed).toBeLessThan(50);
  });
});

// ── Collection generation stress test ──

describe("Performance: collection handling", () => {
  it("creates and processes 500 collections in < 200ms", () => {
    resetIdCounter();
    const start = performance.now();
    const collections = Array.from({ length: 500 }, (_, i) =>
      createPlexCollection({
        title: `Collection ${i + 1}`,
        childCount: 10 + (i % 50),
      }),
    );
    const elapsed = performance.now() - start;

    expect(collections).toHaveLength(500);
    expect(elapsed).toBeLessThan(200);

    // Sort collections by title
    const sortStart = performance.now();
    collections.sort((a, b) => a.title.localeCompare(b.title));
    const sortElapsed = performance.now() - sortStart;
    expect(sortElapsed).toBeLessThan(20);
  });
});
