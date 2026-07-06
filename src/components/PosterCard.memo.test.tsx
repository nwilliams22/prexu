/**
 * Regression test for prexu-0szx.13.
 *
 * The audit found PosterCard's memo() never actually skipped anything in
 * practice: every real list call site passed fresh-identity props on every
 * render (inline onClick/onContextMenu arrows, onPlay from usePlayAction
 * returning a new closure per call, mediaBadges from getItemMediaBadges
 * building a new array per call). A prior test in performance.test.tsx
 * ("PosterCard memo skips re-render when props are identical") doesn't catch
 * that class of bug — it reuses the literal same `props` object across
 * renders, which trivially satisfies memo regardless of whether the real
 * call-site functions are stable.
 *
 * This suite renders PosterCard the way a real list does: deriving props
 * from `item` on every parent render via the actual fixed helpers
 * (getItemMediaBadges + useStableItemCallback), and asserts that PosterCard
 * only actually RE-RUNS (not just "the parent re-rendered") when the item
 * itself changes — not on every unrelated parent re-render.
 *
 * NOTE on measurement technique: an earlier version of this test wrapped
 * PosterCard in a <Profiler> and counted onRender calls. That doesn't work —
 * React's Profiler fires whenever a parent re-render reaches that point in
 * the tree, EVEN when the wrapped memoized component bails out internally
 * without re-invoking its function body (verified empirically). The correct
 * technique — used by PosterCard.scanrender.test.tsx — is a render counter
 * INSIDE a memoized wrapper's own function body: since the wrapper receives
 * the exact props PosterCard would receive, the wrapper's memo bail-out
 * (or lack thereof) is a faithful proxy for PosterCard's own bail-out
 * decision (both use React.memo's default shallow-equal comparator).
 */

import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { memo, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import PosterCard from "./PosterCard";
import { createPlexMovie, resetIdCounter } from "../__tests__/mocks/plex-data";
import { getItemMediaBadges } from "../utils/media-badges";
import { useStableItemCallback } from "../hooks/useStableItemCallback";
import { getProgress, isWatched } from "../utils/media-helpers";
import type { PlexMediaInfo, PlexMediaItem } from "../types/library";

function movieWithMedia(overrides: Partial<PlexMediaItem> = {}): PlexMediaItem {
  const media: PlexMediaInfo = {
    id: 1,
    duration: 100,
    bitrate: 100,
    videoResolution: "2160",
    videoCodec: "hevc",
    audioCodec: "truehd",
    audioChannels: 8,
  };
  return {
    ...createPlexMovie(overrides),
    Media: [media],
  } as PlexMediaItem;
}

interface CountingProps {
  item: PlexMediaItem;
  onClick: () => void;
  onPlay: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  mediaBadges: ReturnType<typeof getItemMediaBadges>;
  /** Continue-watching progress fraction (prexu-tqnq) — derived from
   *  item.viewOffset/duration, exactly like Dashboard.tsx's
   *  `progress={getProgress(item)}` call site. */
  progress: number | undefined;
  /** Watched checkmark (prexu-tqnq) — derived from item, like
   *  Dashboard.tsx's `watched={isWatched(item)}` call site. */
  watched: boolean;
  onBodyRun: () => void;
}

/** Thin memoized proxy around PosterCard whose OWN function body increments
 *  a counter — since it receives the same props PosterCard would, and both
 *  use React.memo's (now explicit, prexu-tqnq) comparator, whether THIS
 *  wrapper's body re-runs is a faithful stand-in for whether PosterCard's
 *  own would. */
const CountingPosterCard = memo(function CountingPosterCard({
  item,
  onClick,
  onPlay,
  onContextMenu,
  mediaBadges,
  progress,
  watched,
  onBodyRun,
}: CountingProps) {
  onBodyRun();
  return (
    <PosterCard
      ratingKey={item.ratingKey}
      imageUrl={item.thumb}
      title={item.title}
      subtitle={String(item.year ?? "")}
      onClick={onClick}
      onPlay={onPlay}
      onContextMenu={onContextMenu}
      onMoreClick={onContextMenu}
      showMoreButton
      mediaBadges={mediaBadges}
      progress={progress}
      watched={watched}
    />
  );
});

/** Mimics a real list call site: onClick/onContextMenu built via the stable
 *  per-key callback cache, onPlay via a stable handler, mediaBadges/progress/
 *  watched via the same helpers Dashboard.tsx calls inline in its `.map()` —
 *  all re-derived from `item` on every render, exactly like a page component
 *  would. A "Rerender parent" button forces this component to re-render
 *  (mimicking an unrelated Dashboard/list re-render) without the item
 *  itself changing. */
function Harness({ item, onBodyRun }: { item: PlexMediaItem; onBodyRun: () => void }) {
  const [, setTick] = useState(0);
  const stableNavigate = useStableItemCallback<PlexMediaItem, () => void>();
  const stablePlay = useStableItemCallback<PlexMediaItem, (e: React.MouseEvent) => void>();
  const stableContextMenu = useStableItemCallback<
    PlexMediaItem,
    (e: React.MouseEvent) => void
  >();

  return (
    <>
      <button onClick={() => setTick((t) => t + 1)}>Rerender parent</button>
      <CountingPosterCard
        item={item}
        onClick={stableNavigate(item.ratingKey, item, () => {})}
        onPlay={stablePlay(item.ratingKey, item, () => {})}
        onContextMenu={stableContextMenu(item.ratingKey, item, () => {})}
        mediaBadges={getItemMediaBadges(item)}
        progress={getProgress(item)}
        watched={isWatched(item)}
        onBodyRun={onBodyRun}
      />
    </>
  );
}

describe("PosterCard memo with realistic call-site props (prexu-0szx.13)", () => {
  it("does not re-run across repeated parent re-renders when props are derived via the fixed helpers", () => {
    resetIdCounter();
    const item = movieWithMedia({ ratingKey: "500", title: "Stable Movie" });
    let bodyRuns = 0;

    render(
      <BrowserRouter>
        <Harness item={item} onBodyRun={() => { bodyRuns++; }} />
      </BrowserRouter>,
    );

    expect(bodyRuns).toBe(1);

    // Force the parent to re-render 5 times without the item itself
    // changing — exactly what happens on Dashboard/PlaylistDetail/
    // CollectionsBrowser whenever ANYTHING unrelated triggers a re-render.
    const button = screen.getByText("Rerender parent");
    for (let i = 0; i < 5; i++) {
      act(() => { button.click(); });
    }

    // The memoized wrapper (and by extension PosterCard, given the same
    // shallow-equal props) must not have re-run its body.
    expect(bodyRuns).toBe(1);
  });

  it("re-runs when the item itself actually changes (sanity check — memo isn't over-suppressing)", () => {
    resetIdCounter();
    let bodyRuns = 0;
    const itemA = movieWithMedia({ ratingKey: "501", title: "Movie A" });
    const itemB = movieWithMedia({ ratingKey: "502", title: "Movie B" });

    const { rerender } = render(
      <BrowserRouter>
        <Harness item={itemA} onBodyRun={() => { bodyRuns++; }} />
      </BrowserRouter>,
    );
    expect(bodyRuns).toBe(1);

    rerender(
      <BrowserRouter>
        <Harness item={itemB} onBodyRun={() => { bodyRuns++; }} />
      </BrowserRouter>,
    );
    expect(bodyRuns).toBe(2);
    expect(screen.getByText("Movie B")).toBeInTheDocument();
  });
});

/**
 * Regression tests for prexu-tqnq.
 *
 * Bug report: after playback stops, the item-detail cache invalidates and
 * a subsequent deck refetch delivers a fresh viewOffset into Dashboard
 * state (verified correct by logging at every cache layer) — but the
 * on-screen card kept showing the OLD progress/resume time until the page
 * was refreshed or revisited. The hypothesis was a memo comparator that
 * omitted watch-state fields (progress/watched/unwatchedCount), so an
 * in-place deck update (same ratingKey, new viewOffset) would never repaint
 * the card even though every upstream layer was correct.
 *
 * These tests isolate exactly that shape of update: the SAME item object
 * reference is mutated in place (mirroring a deck merge that updates
 * viewOffset without replacing the item), so onClick/onContextMenu/onPlay
 * (cached per-ratingKey via useStableItemCallback) and mediaBadges (cached
 * per-object-identity via a WeakMap) all keep the EXACT SAME reference
 * across the re-render — isolating progress/watched as the only prop that
 * actually differs, and proving the comparator reacts to them specifically
 * rather than incidentally re-rendering because some other prop's identity
 * also happened to change.
 */
describe("PosterCard memo watch-state fields (prexu-tqnq)", () => {
  it("repaints when only the item's progress (viewOffset) changes in place", () => {
    resetIdCounter();
    const item = movieWithMedia({
      ratingKey: "600",
      title: "Resume Movie",
      viewOffset: 1000,
      duration: 10000,
    });
    let bodyRuns = 0;

    const { rerender, container } = render(
      <BrowserRouter>
        <Harness item={item} onBodyRun={() => { bodyRuns++; }} />
      </BrowserRouter>,
    );
    expect(bodyRuns).toBe(1);
    let bar = container.querySelector(
      "[style*='background: var(--accent)']",
    ) as HTMLElement | null;
    expect(bar?.style.width).toBe("10%");

    // Mutate the SAME object in place — ratingKey, Media, everything else
    // stays identical. Only viewOffset (and thus progress) changes.
    item.viewOffset = 9000;

    rerender(
      <BrowserRouter>
        <Harness item={item} onBodyRun={() => { bodyRuns++; }} />
      </BrowserRouter>,
    );

    expect(bodyRuns).toBe(2);
    bar = container.querySelector(
      "[style*='background: var(--accent)']",
    ) as HTMLElement | null;
    expect(bar?.style.width).toBe("90%");
  });

  it("repaints when only the item's watched status changes in place", () => {
    resetIdCounter();
    const item = movieWithMedia({
      ratingKey: "601",
      title: "Watched Movie",
      viewCount: 0,
    });
    let bodyRuns = 0;

    const { rerender } = render(
      <BrowserRouter>
        <Harness item={item} onBodyRun={() => { bodyRuns++; }} />
      </BrowserRouter>,
    );
    expect(bodyRuns).toBe(1);
    expect(screen.queryByLabelText("Watched")).not.toBeInTheDocument();

    // Mutate the SAME object in place — item just got marked fully watched.
    (item as unknown as { viewCount: number }).viewCount = 1;

    rerender(
      <BrowserRouter>
        <Harness item={item} onBodyRun={() => { bodyRuns++; }} />
      </BrowserRouter>,
    );

    expect(bodyRuns).toBe(2);
    expect(screen.getByLabelText("Watched")).toBeInTheDocument();
  });

  it("still skips re-render when progress/watched are unchanged (memo hygiene preserved)", () => {
    resetIdCounter();
    const item = movieWithMedia({
      ratingKey: "602",
      title: "Stable Resume Movie",
      viewOffset: 4000,
      duration: 10000,
    });
    let bodyRuns = 0;

    render(
      <BrowserRouter>
        <Harness item={item} onBodyRun={() => { bodyRuns++; }} />
      </BrowserRouter>,
    );
    expect(bodyRuns).toBe(1);

    const button = screen.getByText("Rerender parent");
    for (let i = 0; i < 5; i++) {
      act(() => { button.click(); });
    }

    // Nothing about the item changed — the explicit comparator must still
    // bail out, preserving the render-hygiene win from prexu-0szx.13/.14.
    expect(bodyRuns).toBe(1);
  });
});
