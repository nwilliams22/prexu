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
  onBodyRun: () => void;
}

/** Thin memoized proxy around PosterCard whose OWN function body increments
 *  a counter — since it receives the same props PosterCard would, and both
 *  use React.memo's default shallow comparator, whether THIS wrapper's body
 *  re-runs is a faithful stand-in for whether PosterCard's own would. */
const CountingPosterCard = memo(function CountingPosterCard({
  item,
  onClick,
  onPlay,
  onContextMenu,
  mediaBadges,
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
    />
  );
});

/** Mimics a real list call site: onClick/onContextMenu built via the stable
 *  per-key callback cache, onPlay via a stable handler, mediaBadges via the
 *  memoized media-badges helper — all re-derived from `item` on every
 *  render, exactly like a page component would. A "Rerender parent" button
 *  forces this component to re-render (mimicking an unrelated Dashboard/
 *  list re-render) without the item itself changing. */
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
