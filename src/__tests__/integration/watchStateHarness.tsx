/**
 * Shared wiring for the watch-state resume-label SEAM integration suite (W1).
 *
 * The resume-label saga (PRs #50 → #87) was seven-plus rounds of SEAM bugs:
 * every isolated unit test passed the whole time while a stale "Resume from
 * X:XX" survived in the gap BETWEEN real modules. Unit tests mock the pieces
 * under test; this harness deliberately does NOT. It wires the REAL:
 *
 *   - api-cache            (services/api-cache.ts)        — the cache layer
 *   - cache-invalidators   (services/cache-invalidators.ts) — patch + floor
 *   - watch-state-events   (services/watch-state-events.ts) — the event bus
 *   - useDashboard         — mounted deck STATE (onDeck)
 *   - useItemDetailData    — mounted detail-page item STATE
 *   - usePlayAction        — the resume popover (itemsRef click-handler cache)
 *   - PosterCard           — the REAL memoized deck card (memo comparator NOT
 *                            stubbed — the #69/tqnq bug hid behind exactly it)
 *   - ItemHeroSection      — the REAL memoized detail hero ("Resume from" btn)
 *   - HeroSlideshow        — the REAL memoized dashboard "Continue" hero
 *   - ResumePopover        — the REAL "Resume from {formatTimeMs()}" label
 *
 * ONLY the true external boundary is faked by the consuming test: the Plex
 * HTTP fetch layer (services/plex-library) — so a test controls what the
 * "server" returns and WHEN. Everything from the fetch response inward is
 * real, so a surface that reads a data layer nothing updated goes visibly
 * stale exactly as it did on hardware.
 *
 * The surfaces below mirror the actual production wiring:
 *   - DeckShelfSurface  ≈ Dashboard.tsx:576/582 (getProgress + getPlayHandler)
 *   - HeroContinueSurface ≈ Dashboard.tsx:296-318/433-451 (heroItemMap →
 *     handleHeroPlay → getPlayHandler; getProgress-driven HeroSlide.progress)
 *   - DetailHeroSurface ≈ ItemDetail.tsx mounting memo(ItemHeroSection) with
 *     useItemDetailData().item (the hero reads item.viewOffset directly)
 *   - StaticCardPopoverSurface — the #87 isolation: a memoized card whose
 *     props NEVER change after mount, so the ONLY route a post-stop offset
 *     reaches the popover is usePlayAction's itemsRef patch.
 */
import { act, render, fireEvent } from "@testing-library/react";
import { getProgress } from "../../utils/media-helpers";
import { useDashboard } from "../../hooks/useDashboard";
import { usePlayAction } from "../../hooks/usePlayAction";
import { useItemDetailData } from "../../hooks/useItemDetailData";
import PosterCard from "../../components/PosterCard";
import HeroSlideshow, { type HeroSlide } from "../../components/HeroSlideshow";
import ItemHeroSection from "../../components/detail/ItemHeroSection";
import EpisodeListSection from "../../components/detail/EpisodeListSection";
import ErrorState from "../../components/ErrorState";
import { cacheClear, cacheSet } from "../../services/api-cache";
import {
  initializeCacheInvalidators,
  __clearOffsetFloorsForTests,
  DECK_INVALIDATION_DELAY_MS,
  OFFSET_FLOOR_WINDOW_MS,
} from "../../services/cache-invalidators";
import {
  emitWatchStateChanged,
  type WatchStateOffset,
} from "../../services/watch-state-events";
import type {
  PlexMediaItem,
  PlexEpisode,
  PlexMovie,
  PlexSeason,
  PlexShow,
} from "../../types/library";

// ── Fixed test world ──────────────────────────────────────────────────────

/** The one "server" the whole suite talks to — must match the useAuth mock. */
export const SERVER = { uri: "https://plex.test", accessToken: "token" };
export const DECK_KEY = `dashboard:${SERVER.uri}:deck`;
export const detailKey = (ratingKey: string): string =>
  `item-detail:${SERVER.uri}:${ratingKey}`;

/** useDashboard's onDeck cache TTL (60 min). */
export const DECK_TTL = 60 * 60 * 1000;
/** useItemDetailData's bundle cache TTL (30 s). */
export const DETAIL_TTL = 30_000;

export { DECK_INVALIDATION_DELAY_MS, OFFSET_FLOOR_WINDOW_MS };

/** A partially watched item's total runtime — makes getProgress well-defined. */
export const DURATION_MS = 1_000_000;

// ── Data factories ────────────────────────────────────────────────────────

export function makeMovie(
  ratingKey: string,
  viewOffset: number,
  extra: Partial<PlexMovie> = {},
): PlexMovie {
  return {
    ratingKey,
    title: `Movie ${ratingKey}`,
    type: "movie",
    thumb: `/thumb/${ratingKey}`,
    art: `/art/${ratingKey}`,
    addedAt: 0,
    year: 2020,
    duration: DURATION_MS,
    viewOffset,
    viewCount: 0,
    ...extra,
  } as PlexMovie;
}

export function makeEpisode(
  ratingKey: string,
  viewOffset: number,
  extra: Partial<PlexEpisode> = {},
): PlexEpisode {
  return {
    ratingKey,
    title: `Episode ${ratingKey}`,
    type: "episode",
    thumb: `/thumb/${ratingKey}`,
    addedAt: 0,
    duration: DURATION_MS,
    viewOffset,
    parentRatingKey: "season-1",
    parentIndex: 1,
    index: 1,
    grandparentRatingKey: "show-1",
    grandparentTitle: "Show",
    parentTitle: "Season 1",
    viewCount: 0,
    ...extra,
  } as PlexEpisode;
}

/** A season item — the `item` a season DETAIL page mounts (episodes are its children). */
export function makeSeason(
  ratingKey: string,
  extra: Partial<PlexSeason> = {},
): PlexSeason {
  return {
    ratingKey,
    title: `Season ${ratingKey}`,
    type: "season",
    thumb: `/thumb/${ratingKey}`,
    addedAt: 0,
    index: 1,
    parentRatingKey: "show-1",
    parentTitle: "Show",
    parentThumb: "/thumb/show-1",
    leafCount: 1,
    viewedLeafCount: 0,
    ...extra,
  } as PlexSeason;
}

/** A show item — fetched as a season's `parentShow` (see fetchDetailBundle's season branch). */
export function makeShow(
  ratingKey: string,
  extra: Partial<PlexShow> = {},
): PlexShow {
  return {
    ratingKey,
    title: `Show ${ratingKey}`,
    type: "show",
    thumb: `/thumb/${ratingKey}`,
    addedAt: 0,
    year: 2020,
    childCount: 1,
    leafCount: 1,
    viewedLeafCount: 0,
    studio: "Test Studio",
    ...extra,
  } as PlexShow;
}

// ── Cache seeding ─────────────────────────────────────────────────────────

export function seedDeckCache(items: PlexMediaItem[]): void {
  cacheSet(DECK_KEY, items, DECK_TTL);
}

/**
 * Seed the item-detail bundle cache exactly as useItemDetailData shapes it.
 * `episodes` lets a season-page seed carry its child episode list (see
 * EpisodeListSurface below) — defaults to `[]`, matching every non-season
 * caller's prior behavior exactly.
 */
export function seedDetailCache(
  item: PlexMediaItem,
  episodes: PlexEpisode[] = [],
): void {
  cacheSet(
    detailKey(item.ratingKey),
    {
      item,
      seasons: [],
      episodes,
      parentShow: null,
      siblingSeasons: [],
      siblingEpisodes: [],
    },
    DETAIL_TTL,
  );
}

// ── Module-level wiring (mirrors main.tsx app boot) ───────────────────────

// initializeCacheInvalidators() registers a permanent window listener and
// never unsubscribes (by design). Vitest isolates module state per test file,
// so installing exactly once per file gives the one persistent invalidator a
// real app has — re-calling it every beforeEach would pile up duplicate
// (idempotent, but leaky) listeners.
let invalidatorsInstalled = false;
export function installInvalidatorsOnce(): void {
  if (!invalidatorsInstalled) {
    initializeCacheInvalidators();
    invalidatorsInstalled = true;
  }
}

/**
 * Reset every piece of leak-prone shared module state between tests. Note:
 * vi.clearAllMocks / restoreMocks do NOT touch these — the cache store and
 * the offset-floor registry are plain module singletons and MUST be cleared
 * explicitly or a floor/patch bleeds into the next test (see
 * cache-invalidators.__clearOffsetFloorsForTests, used by the existing
 * cache-invalidators/useDashboard suites for the same reason).
 */
export function resetWatchStateWorld(): void {
  cacheClear();
  __clearOffsetFloorsForTests();
}

// ── Event + timer drivers ─────────────────────────────────────────────────

/** Emit the REAL watch-state stop event the player fires after a stop write. */
export function emitStop(ratingKey: string, offset: WatchStateOffset): void {
  act(() => {
    emitWatchStateChanged(ratingKey, offset);
  });
}

/** Emit a payload-less legacy event (bare emitWatchStateChanged()). */
export function emitLegacyStop(): void {
  act(() => {
    emitWatchStateChanged();
  });
}

/** Advance fake timers inside act(), flushing the promises they unblock. */
export async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Mount a surface and flush its same-tick mount fetches (fake timers). */
export async function mountAndSettle(
  ui: React.ReactElement,
): Promise<ReturnType<typeof render>> {
  const utils = render(ui);
  await advance(0);
  return utils;
}

/**
 * Click a "Play"/"Continue" affordance, carrying a click position so
 * usePlayAction's popover has an anchor (it reads e.clientX/e.clientY).
 * fireEvent bypasses the hover-gated opacity/pointer-events the button
 * carries in the real UI, which is irrelevant to the data seam under test.
 */
export function clickPlay(button: HTMLElement): void {
  act(() => {
    fireEvent.click(button, { clientX: 20, clientY: 20 });
  });
}

// ── Surfaces (real hooks + real memoized components) ──────────────────────

/**
 * Dashboard "Continue Watching" deck shelf: real useDashboard onDeck state →
 * real memo(PosterCard) (progress bar) → real usePlayAction → real
 * ResumePopover ("Resume from"). Mirrors Dashboard.tsx:576/582.
 */
export function DeckShelfSurface(): React.ReactElement {
  const { onDeck } = useDashboard();
  const { getPlayHandler, playOverlay } = usePlayAction();
  return (
    <div data-testid="deck-shelf">
      {onDeck.map((item, i) => (
        <div key={item.ratingKey} data-testid={`deck-card-${item.ratingKey}`}>
          <PosterCard
            imageUrl="/img"
            title={item.title}
            ratingKey={item.ratingKey}
            progress={getProgress(item)}
            onPlay={getPlayHandler(item)}
            index={i}
          />
        </div>
      ))}
      {playOverlay}
    </div>
  );
}

/**
 * The #87 (prexu-r8ib) isolation. A single memoized PosterCard whose props
 * NEVER change after mount — no consumer state reacts to the watch-state
 * event, so the card provably does not re-render and getPlayHandler is not
 * re-invoked. The ONLY path by which a post-stop offset can reach the popover
 * is usePlayAction's own itemsRef watch-state patch. Remove that subscription
 * and this surface's popover shows the stale pre-stop offset.
 */
export function StaticCardPopoverSurface({
  item,
}: {
  item: PlexMediaItem;
}): React.ReactElement {
  const { getPlayHandler, playOverlay } = usePlayAction();
  const onPlay = getPlayHandler(item);
  return (
    <div data-testid="static-card">
      <PosterCard
        imageUrl="/img"
        title={item.title}
        ratingKey={item.ratingKey}
        progress={getProgress(item)}
        onPlay={onPlay}
      />
      {playOverlay}
    </div>
  );
}

/**
 * Dashboard hero "Continue" affordance: real useDashboard onDeck →
 * getProgress-driven HeroSlide.progress → real memo(HeroSlideshow) →
 * handleHeroPlay (heroItemMap lookup → getPlayHandler) → real ResumePopover.
 * Mirrors Dashboard.tsx:296-318 + 433-451 + 534.
 */
export function HeroContinueSurface(): React.ReactElement {
  const { onDeck } = useDashboard();
  const { getPlayHandler, playOverlay } = usePlayAction();
  const slides: HeroSlide[] = onDeck.map((item) => ({
    ratingKey: item.ratingKey,
    title: item.title,
    backdropUrl: "/bg",
    progress: getProgress(item),
    category: "Continue Watching",
  }));
  const handleHeroPlay = (ratingKey: string, e: React.MouseEvent) => {
    const item = onDeck.find((i) => i.ratingKey === ratingKey);
    const handler = item ? getPlayHandler(item) : undefined;
    if (handler) handler(e);
  };
  return (
    <>
      <HeroSlideshow slides={slides} onPlay={handleHeroPlay} />
      {playOverlay}
    </>
  );
}

/**
 * Detail page hero: real useItemDetailData mounted item state → real
 * memo(ItemHeroSection). The hero renders "▶ Resume from {formatResumeTime}"
 * straight off item.viewOffset (no usePlayAction fallback), so its label is
 * governed solely by useItemDetailData's mounted-state patch (#83/kwqe) and
 * the detail fetch's offset floor (#81/5mcz).
 */
export function DetailHeroSurface(): React.ReactElement {
  const { item } = useItemDetailData();
  if (!item) return <div data-testid="detail-loading">loading</div>;
  return (
    <div data-testid="detail-hero">
      <ItemHeroSection
        item={item as PlexMovie}
        artUrl={(p) => p}
        posterUrl={(p) => p}
        isAdmin={false}
        onFixMatch={() => {}}
        refreshItem={() => {}}
      />
    </div>
  );
}

/**
 * Full loading/error/hero slice of the detail page: real useItemDetailData →
 * real ErrorState (retry wired straight to refreshItem) on a fetch failure,
 * OR real memo(ItemHeroSection) once content loads. Mirrors ItemDetail.tsx's
 * isLoading/error/movie branches (~304-333).
 *
 * The J.5 gap this closes: ItemDetail.test.tsx mocks BOTH ErrorState and
 * useItemDetailData, so it only proves "clicking Retry calls refreshItem" —
 * never that a REAL retry-triggered refetch actually clears the REAL error
 * and paints REAL recovered content. This surface mounts both for real, over
 * the same fake Plex-fetch boundary as every other surface in this file, so
 * a retry loop that silently fails to clear `error` (or never re-fetches)
 * would leave the ErrorState mounted forever instead of surfacing content.
 */
export function DetailPageSurface(): React.ReactElement {
  const { item, isLoading, error, refreshItem } = useItemDetailData();
  if (isLoading) return <div data-testid="detail-loading">loading</div>;
  if (error || !item) {
    return (
      <div data-testid="detail-error">
        <ErrorState message={error ?? "Item not found"} onRetry={refreshItem} />
      </div>
    );
  }
  return (
    <div data-testid="detail-hero">
      <ItemHeroSection
        item={item as PlexMovie}
        artUrl={(p) => p}
        posterUrl={(p) => p}
        isAdmin={false}
        onFixMatch={() => {}}
        refreshItem={refreshItem}
      />
    </div>
  );
}

/**
 * Season detail page's episode-row LIST: real useItemDetailData mounted
 * `episodes` STATE → real EpisodeListSection → real usePlayAction → real
 * ResumePopover. Mirrors ItemDetail.tsx:579-593 (the "season" branch).
 *
 * The gap this closes: the suite's only episode coverage
 * ("applies to an episode row's own resume label", below) mounts an episode
 * as the page's own `item` on DetailHeroSurface — exercising useItemDetailData's
 * listener's `matchesItem` branch only. A season page's episode LIST instead
 * runs through the listener's `matchesEpisodes`/`matchesSiblingEpisodes`
 * branch (useItemDetailData.ts ~600-641), which patches one entry INSIDE the
 * mounted `episodes` ARRAY — untested until now.
 *
 * The `episode-offset-*` spans below are test-only instrumentation (NOT part
 * of the real EpisodeListSection tree) exposing the mounted `episodes[]`
 * state's own viewOffset directly. They exist because usePlayAction keeps its
 * OWN independent itemsRef patch on the exact same event (see
 * StaticCardPopoverSurface's #87 anchor above) — every render of a row calls
 * `getPlayHandler(ep)`, which re-warms itemsRef with whatever `ep` it was
 * just given, so the ResumePopover alone can't distinguish "useItemDetailData's
 * `episodes` state was patched" from "usePlayAction's own listener patched
 * itemsRef independently of that state". The spans give this suite a direct,
 * unambiguous read on the STATE this surface's gap is actually about, while
 * the popover click still proves the end-to-end rendered-label outcome.
 */
export function EpisodeListSurface(): React.ReactElement {
  const { episodes } = useItemDetailData();
  return (
    <div data-testid="episode-list">
      {episodes.map((ep) => (
        <span key={ep.ratingKey} data-testid={`episode-offset-${ep.ratingKey}`}>
          {ep.viewOffset ?? 0}
        </span>
      ))}
      <EpisodeListSection
        episodes={episodes}
        seasonFading={false}
        episodeThumbUrl={(p) => p}
        formatDuration={(ms) => `${ms}ms`}
      />
    </div>
  );
}
