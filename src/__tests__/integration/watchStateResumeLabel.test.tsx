/**
 * W1 — Watch-state resume-label SEAM integration suite.
 *
 * The single highest-value regression guard from docs/test-automation-plan.md.
 * A stale "Resume from X:XX" label survived SEVEN-PLUS validation rounds
 * (PRs #50 → #87) because every UNIT test passed while the bug lived in the
 * SEAMS between real modules. This suite mounts the REAL consumer SURFACES
 * (Dashboard deck card + popover, Dashboard hero "Continue", detail-page hero)
 * over the REAL api-cache + cache-invalidators + watch-state-events bus, and
 * asserts the RENDERED label — the thing the user actually sees.
 *
 * The three data layers a surface can read (per bd memory): (1) the server,
 * (2) the api-cache, (3) the mounted React hook STATE. A surface goes stale if
 * it reads a layer nothing updated. The invariants below drive a play → stop
 * reporting a final offset B (from a prior offset A) and assert every surface
 * shows B — at T+0 (mounted-state patch), after the delayed refetch
 * (server-timing), after a full remount (cache-seed), and when a prefetch
 * races the ingestion window (floor/guard).
 *
 * ONLY the Plex HTTP fetch layer (services/plex-library) is mocked — the true
 * external boundary. Everything from the fetch response inward is real,
 * including the memoized PosterCard / ItemHeroSection / HeroSlideshow render
 * chains (memo comparators NOT stubbed — the #69/tqnq bug hid behind them).
 *
 * See watchStateHarness.tsx for the surfaces and the fake-fetch wiring.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, within, act, cleanup } from "@testing-library/react";
import { formatTimeMs } from "../../utils/time-format";
import { warmItemDetailCache } from "../../hooks/useItemDetailData";
import {
  SERVER,
  DECK_KEY,
  detailKey,
  DECK_TTL,
  DECK_INVALIDATION_DELAY_MS,
  DURATION_MS,
  makeMovie,
  makeEpisode,
  seedDeckCache,
  seedDetailCache,
  installInvalidatorsOnce,
  resetWatchStateWorld,
  emitStop,
  emitLegacyStop,
  advance,
  mountAndSettle,
  clickPlay,
  DeckShelfSurface,
  StaticCardPopoverSurface,
  HeroContinueSurface,
  DetailHeroSurface,
} from "./watchStateHarness";
import { cacheGet, cacheSet } from "../../services/api-cache";

// ── The one item under test, watched from A to B ──────────────────────────
const RK = "555";
const A = 372_000; // 6:12 — the PRIOR session's offset (the stale value)
const B = 470_000; // 7:50 — what the player just reported at stop
const LABEL_A = formatTimeMs(A); // "6:12"
const LABEL_B = formatTimeMs(B); // "7:50"

// ── Mocks: ONLY the external boundary (Plex HTTP) + unavoidable app context ─
// The Plex fetch layer — the ONE thing we fake so the test controls what the
// "server" returns and when.
const mockGetOnDeck = vi.fn();
const mockGetRecentlyAddedBySection = vi.fn();
const mockGetItemMetadata = vi.fn();
const mockGetItemChildren = vi.fn();
const mockGetRelatedItems = vi.fn();
const mockGetExtras = vi.fn();
const mockGetMediaByActor = vi.fn();
const mockGetCollections = vi.fn();
const mockGetCollectionItems = vi.fn();
vi.mock("../../services/plex-library", () => ({
  getOnDeck: (...a: unknown[]) => mockGetOnDeck(...a),
  getRecentlyAddedBySection: (...a: unknown[]) => mockGetRecentlyAddedBySection(...a),
  getItemMetadata: (...a: unknown[]) => mockGetItemMetadata(...a),
  getItemChildren: (...a: unknown[]) => mockGetItemChildren(...a),
  getRelatedItems: (...a: unknown[]) => mockGetRelatedItems(...a),
  getExtras: (...a: unknown[]) => mockGetExtras(...a),
  getMediaByActor: (...a: unknown[]) => mockGetMediaByActor(...a),
  getCollections: (...a: unknown[]) => mockGetCollections(...a),
  getCollectionItems: (...a: unknown[]) => mockGetCollectionItems(...a),
}));

// Player boundary: play() just starts the native player; not part of the seam.
const mockPlay = vi.fn();
vi.mock("../../contexts/PlayerContext", () => ({
  usePlayerSession: () => ({
    session: null,
    play: mockPlay,
    stop: vi.fn(),
    replaceRatingKey: vi.fn(),
    updateSession: vi.fn(),
  }),
}));

// Auth / library / activity context — kept constant so the seam, not the
// environment, is what varies. server.uri MUST match harness SERVER.uri.
// A STABLE reference is essential: useItemDetailData keys effects on the
// `server` object identity, so a fresh object per render would loop forever.
const stableServer = { uri: "https://plex.test", accessToken: "token" };
vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ server: stableServer }),
}));
vi.mock("../../hooks/useLibrary", () => ({
  useLibrary: () => ({
    sections: [{ key: "1", title: "Movies", type: "movie", updatedAt: 0 }],
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../hooks/useServerActivity", () => ({
  useCompletionCounter: () => 0,
  useIsScanning: () => false,
}));
vi.mock("../../hooks/usePreferences", () => ({
  usePreferences: () => ({
    preferences: { appearance: { skipSingleSeason: false } },
    updatePreferences: vi.fn(),
    resetPreferences: vi.fn(),
  }),
}));

// react-router — useItemDetailData reads useParams().ratingKey and keys its
// primary fetch effect on the navigate identity, so navigate MUST be a stable
// reference (a fresh fn per render would re-run the effect every render and,
// on a cold load, spin an infinite setSeasons([]) render loop before the
// fetch can populate the cache). HeroSlideshow/ItemHeroSection also call it.
let currentRatingKey = RK;
const stableNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ ratingKey: currentRatingKey }),
    useNavigate: () => stableNavigate,
  };
});

// Heavy detail-hero leaf buttons — siblings of the resume affordance, outside
// the seam. Stubbed so ItemHeroSection mounts without Tauri/WS/toast context.
// NOTE: this does NOT stub ItemHeroSection itself or its memo() — the real
// memoized hero (which renders "Resume from" off item.viewOffset) is intact.
vi.mock("../../components/WatchTogetherButton", () => ({ default: () => null }));
vi.mock("../../components/WatchedToggleButton", () => ({ default: () => null }));
vi.mock("../../components/detail/DownloadButton", () => ({ default: () => null }));
vi.mock("../../components/player/SubtitleSearchPanel", () => ({ default: () => null }));
vi.mock("../../services/subtitle-search", () => ({
  setSelectedSubtitleStream: vi.fn(),
}));

// ── Assertion helpers ─────────────────────────────────────────────────────

function expectResumeLabel(offsetLabel: string): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`Resume from ${offsetLabel.replace(":", "\\:")}`),
  });
}
function expectNoResumeLabel(offsetLabel: string): void {
  expect(
    screen.queryByRole("button", {
      name: new RegExp(`Resume from ${offsetLabel.replace(":", "\\:")}`),
    }),
  ).toBeNull();
}

/** The PosterCard progress bar (the memoized card's repaint evidence). */
function progressBarWidth(scope: HTMLElement): string | null {
  const bars = Array.from(scope.querySelectorAll("div")).filter(
    (d) => d.style.height === "100%" && d.style.width.endsWith("%"),
  );
  return bars[0]?.style.width ?? null;
}
const pct = (offset: number) => `${(offset / DURATION_MS) * 100}%`;

beforeEach(() => {
  vi.useFakeTimers();
  resetWatchStateWorld();
  currentRatingKey = RK;
  // Clear CALL HISTORY on the module-level stubs. restoreMocks:true does not
  // reliably clear these hand-rolled vi.fn()s between tests, so `getOnDeck`
  // call counts would otherwise accumulate across the file (the existing
  // useDashboard integration suite calls mockReset() for the same reason).
  vi.clearAllMocks();
  // Re-prime EVERY stub AFTER clearing (clearAllMocks wipes implementations
  // of factory vi.fn()s too — mockReturnValue/mockResolvedValue must be reset).
  mockGetOnDeck.mockResolvedValue([]);
  mockGetRecentlyAddedBySection.mockResolvedValue([]);
  mockGetItemMetadata.mockResolvedValue(makeMovie(RK, 0));
  mockGetItemChildren.mockResolvedValue([]);
  mockGetRelatedItems.mockResolvedValue([]);
  mockGetExtras.mockResolvedValue([]);
  mockGetMediaByActor.mockResolvedValue([]);
  mockGetCollections.mockResolvedValue([]);
  mockGetCollectionItems.mockResolvedValue({ items: [] });
  // One persistent invalidator listener for the whole file (as at app boot).
  installInvalidatorsOnce();
});

afterEach(async () => {
  // Unmount every surface FIRST — this fires each hook's effect cleanup
  // (unsubscribe from the bus, clearTimeout the pending deck refresh) so the
  // subsequent flush can't cascade a refetch through a still-mounted tree.
  cleanup();
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════
// SURFACE 1 — Dashboard deck card popover (PosterCard → usePlayAction →
// ResumePopover). Mirrors Dashboard.tsx:576/582.
// ═══════════════════════════════════════════════════════════════════════════
describe("deck card popover — resume label reflects the final offset B", () => {
  it("(a) T+0: mounted deck STATE patch shows B immediately, before any refetch (#85/prexu-0fwh)", async () => {
    seedDeckCache([makeMovie(RK, A)]);
    // Deliberately STALE refetch — proves T+0 correctness comes from the
    // in-place mounted-state patch, not from the (deferred) revalidation.
    mockGetOnDeck.mockResolvedValue([makeMovie(RK, A)]);
    const { getByTestId } = await mountAndSettle(<DeckShelfSurface />);

    const card = getByTestId(`deck-card-${RK}`);
    expect(progressBarWidth(card)).toBe(pct(A));

    emitStop(RK, { viewOffsetMs: B });

    // No timer advance, no refetch: the memoized card must have repainted the
    // progress bar to B AND the popover must read B.
    expect(mockGetOnDeck).not.toHaveBeenCalled();
    expect(progressBarWidth(card)).toBe(pct(B));

    clickPlay(within(card).getByLabelText("Play"));
    expectResumeLabel(LABEL_B);
    expectNoResumeLabel(LABEL_A);
  });

  it("(b) delayed deck refetch corrects a payload-less stop via the server (#79/#64)", async () => {
    seedDeckCache([makeMovie(RK, A)]);
    mockGetOnDeck.mockResolvedValue([makeMovie(RK, B)]); // PMS has ingested by now
    const { getByTestId } = await mountAndSettle(<DeckShelfSurface />);
    const card = getByTestId(`deck-card-${RK}`);

    // Legacy event carries no offset → no in-place patch; only the delayed
    // refetch can correct the label (the pre-#85 world for every surface).
    emitLegacyStop();
    expect(progressBarWidth(card)).toBe(pct(A)); // still stale at T+0

    await advance(DECK_INVALIDATION_DELAY_MS);
    expect(mockGetOnDeck).toHaveBeenCalledTimes(1);
    expect(progressBarWidth(card)).toBe(pct(B));

    clickPlay(within(card).getByLabelText("Play"));
    expectResumeLabel(LABEL_B);
  });

  it("(c) full unmount/remount seeds fresh deck state from the patched cache (#83-analog/#50)", async () => {
    seedDeckCache([makeMovie(RK, A)]);
    mockGetOnDeck.mockResolvedValue([makeMovie(RK, A)]); // server still stale
    const first = await mountAndSettle(<DeckShelfSurface />);

    emitStop(RK, { viewOffsetMs: B });
    // cache-invalidators.patchDeckCaches wrote B into the deck cache synchronously.
    expect((cacheGet(DECK_KEY) as { viewOffset: number }[])[0]!.viewOffset).toBe(B);

    first.unmount();
    const remounted = await mountAndSettle(<DeckShelfSurface />);
    const card = remounted.getByTestId(`deck-card-${RK}`);
    expect(progressBarWidth(card)).toBe(pct(B));

    clickPlay(within(card).getByLabelText("Play"));
    expectResumeLabel(LABEL_B);
  });

  it("(d) offset floor overrides a stale deck refetch that lands inside the ingestion window (#79)", async () => {
    seedDeckCache([makeMovie(RK, A)]);
    // The delayed refetch resolves with the PRE-stop offset (PMS not ingested
    // yet) — applyOffsetFloors must override it to the client-known B.
    mockGetOnDeck.mockResolvedValue([makeMovie(RK, A)]);
    const { getByTestId } = await mountAndSettle(<DeckShelfSurface />);
    const card = getByTestId(`deck-card-${RK}`);

    emitStop(RK, { viewOffsetMs: B }); // registers floor B, patches onDeck → B
    expect(progressBarWidth(card)).toBe(pct(B));

    await advance(DECK_INVALIDATION_DELAY_MS); // stale refetch lands, gets floored
    expect(mockGetOnDeck).toHaveBeenCalledTimes(1);
    expect(progressBarWidth(card)).toBe(pct(B));
    expect((cacheGet(DECK_KEY) as { viewOffset: number }[])[0]!.viewOffset).toBe(B);

    clickPlay(within(card).getByLabelText("Play"));
    expectResumeLabel(LABEL_B);
  });

  it("RESET (early-stop unscrobble → 0): card drops its progress bar and plays from the beginning", async () => {
    seedDeckCache([makeMovie(RK, A)]);
    mockGetItemMetadata.mockResolvedValue(makeMovie(RK, 0)); // slow-path verify → 0
    const { getByTestId } = await mountAndSettle(<DeckShelfSurface />);
    const card = getByTestId(`deck-card-${RK}`);
    expect(progressBarWidth(card)).toBe(pct(A));

    emitStop(RK, { viewOffsetMs: 0, reset: true });
    expect(progressBarWidth(card)).toBeNull(); // no resume marker → no bar

    clickPlay(within(card).getByLabelText("Play"));
    await advance(0);
    expectNoResumeLabel(LABEL_A);
    expect(screen.queryByRole("button", { name: /Resume from/ })).toBeNull();
    expect(mockPlay).toHaveBeenCalledWith(RK);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SURFACE 1b — usePlayAction itemsRef patch, ISOLATED (#87/prexu-r8ib).
// Revert-proof anchor: the memoized card provably never re-renders here.
// ═══════════════════════════════════════════════════════════════════════════
describe("static memoized card popover — itemsRef patch is the only path to B (#87)", () => {
  it("REVERT-PROOF: popover shows B though the card never re-rendered (remove usePlayAction's watch-state subscription → shows A)", async () => {
    const item = makeMovie(RK, A);
    await mountAndSettle(<StaticCardPopoverSurface item={item} />);
    const card = screen.getByTestId("static-card");

    // A viewOffset-only stop with NO consumer re-render: only usePlayAction's
    // itemsRef subscription can carry B to the click-time popover.
    emitStop(RK, { viewOffsetMs: B });
    clickPlay(within(card).getByLabelText("Play"));

    expectResumeLabel(LABEL_B);
    expectNoResumeLabel(LABEL_A);
    expect(mockGetItemMetadata).not.toHaveBeenCalled(); // fast path, no fetch
  });

  it("RESET zeroes the cached item so the click plays from the beginning (no resume popover)", async () => {
    const item = makeMovie(RK, A);
    mockGetItemMetadata.mockResolvedValue(makeMovie(RK, 0));
    await mountAndSettle(<StaticCardPopoverSurface item={item} />);
    const card = screen.getByTestId("static-card");

    emitStop(RK, { viewOffsetMs: 0, reset: true });
    clickPlay(within(card).getByLabelText("Play"));
    await advance(0);

    expect(screen.queryByRole("button", { name: /Resume from/ })).toBeNull();
    expect(mockPlay).toHaveBeenCalledWith(RK);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SURFACE 2 — Dashboard hero "Continue" (HeroSlideshow → handleHeroPlay →
// getPlayHandler → ResumePopover). Mirrors Dashboard.tsx:296-318/433-451/534.
// ═══════════════════════════════════════════════════════════════════════════
describe("dashboard hero Continue — resume label reflects the final offset B", () => {
  it("(a) T+0: hero reads the patched onDeck state, so Continue's popover shows B (#85/prexu-0fwh)", async () => {
    seedDeckCache([makeMovie(RK, A)]);
    mockGetOnDeck.mockResolvedValue([makeMovie(RK, A)]); // stale refetch
    await mountAndSettle(<HeroContinueSurface />);

    // Progress > 0 → the affordance reads "Continue", not "Play".
    expect(screen.getByRole("button", { name: /Continue/ })).toBeTruthy();

    emitStop(RK, { viewOffsetMs: B });
    expect(mockGetOnDeck).not.toHaveBeenCalled();

    clickPlay(screen.getByRole("button", { name: /Continue/ }));
    expectResumeLabel(LABEL_B);
    expectNoResumeLabel(LABEL_A);
  });

  it("(b) delayed refetch corrects a payload-less stop, and Continue then shows B (#79)", async () => {
    seedDeckCache([makeMovie(RK, A)]);
    mockGetOnDeck.mockResolvedValue([makeMovie(RK, B)]);
    await mountAndSettle(<HeroContinueSurface />);

    emitLegacyStop();
    await advance(DECK_INVALIDATION_DELAY_MS);
    expect(mockGetOnDeck).toHaveBeenCalledTimes(1);

    clickPlay(screen.getByRole("button", { name: /Continue/ }));
    expectResumeLabel(LABEL_B);
  });

  it("(c) full unmount/remount reseeds the hero from the patched cache → B", async () => {
    seedDeckCache([makeMovie(RK, A)]);
    mockGetOnDeck.mockResolvedValue([makeMovie(RK, A)]);
    const first = await mountAndSettle(<HeroContinueSurface />);
    emitStop(RK, { viewOffsetMs: B });
    first.unmount();

    await mountAndSettle(<HeroContinueSurface />);
    clickPlay(screen.getByRole("button", { name: /Continue/ }));
    expectResumeLabel(LABEL_B);
  });

  it("RESET: a reset offset flips the affordance back to Play with no progress bar", async () => {
    seedDeckCache([makeMovie(RK, A)]);
    mockGetItemMetadata.mockResolvedValue(makeMovie(RK, 0));
    await mountAndSettle(<HeroContinueSurface />);
    expect(screen.getByRole("button", { name: /Continue/ })).toBeTruthy();

    emitStop(RK, { viewOffsetMs: 0, reset: true });
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Play/ })).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SURFACE 3 — Detail page hero play button (useItemDetailData → memo(
// ItemHeroSection), which renders "▶ Resume from" straight off item.viewOffset).
// ═══════════════════════════════════════════════════════════════════════════
describe("detail-page hero — resume label reflects the final offset B", () => {
  it("(a) T+0: mounted item STATE patch updates the hero label immediately (#83/prexu-kwqe)", async () => {
    seedDetailCache(makeMovie(RK, A));
    await mountAndSettle(<DetailHeroSurface />);
    expectResumeLabel(LABEL_A); // painted from cache on entry

    emitStop(RK, { viewOffsetMs: B });
    // No advance, no refetch: the mounted-state patch → new item identity →
    // memo(ItemHeroSection) repaints the label to B.
    expectResumeLabel(LABEL_B);
    expectNoResumeLabel(LABEL_A);
  });

  it("(b) cold load surfaces the server's (already-ingested) offset B", async () => {
    // No cache — a true cold detail load fetches from the server.
    mockGetItemMetadata.mockResolvedValue(makeMovie(RK, B));
    await mountAndSettle(<DetailHeroSurface />);
    expectResumeLabel(LABEL_B);
  });

  it("(c) full unmount/remount reads B back from the patched detail cache (#81 TTL refresh)", async () => {
    seedDetailCache(makeMovie(RK, A));
    const first = await mountAndSettle(<DetailHeroSurface />);
    emitStop(RK, { viewOffsetMs: B });
    // patchItemDetailCache wrote B into the bundle with a refreshed TTL.
    expect(
      (cacheGet(detailKey(RK)) as { item: { viewOffset: number } }).item.viewOffset,
    ).toBe(B);

    first.unmount();
    await mountAndSettle(<DetailHeroSurface />);
    expectResumeLabel(LABEL_B);
  });

  it("(d) a hover-prefetch racing the ingestion window is floored to B, so the hero opens on B (#81/prexu-5mcz)", async () => {
    // Stop arrives with no cached bundle yet: registers offset floor B.
    emitStop(RK, { viewOffsetMs: B });
    // A hover-intent prefetch (warmItemDetailCache) now fetches — and PMS is
    // still serving the PRE-stop offset A. applyDetailOffsetFloor must floor
    // the fetched bundle to B before it is cached.
    mockGetItemMetadata.mockResolvedValue(makeMovie(RK, A));
    await act(async () => {
      await warmItemDetailCache(SERVER, RK);
    });
    expect(
      (cacheGet(detailKey(RK)) as { item: { viewOffset: number } }).item.viewOffset,
    ).toBe(B);

    await mountAndSettle(<DetailHeroSurface />);
    expectResumeLabel(LABEL_B);
    expectNoResumeLabel(LABEL_A);
  });

  it("RESET: an early-stop clear zeroes the hero → '▶ Play', no resume label", async () => {
    seedDetailCache(makeMovie(RK, A));
    await mountAndSettle(<DetailHeroSurface />);
    expectResumeLabel(LABEL_A);

    emitStop(RK, { viewOffsetMs: 0, reset: true });
    expect(screen.queryByRole("button", { name: /Resume from/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Play/ })).toBeTruthy();
  });

  it("applies to an episode row's own resume label on a detail page too", async () => {
    seedDetailCache(makeEpisode(RK, A));
    currentRatingKey = RK;
    await mountAndSettle(<DetailHeroSurface />);
    expectResumeLabel(LABEL_A);

    emitStop(RK, { viewOffsetMs: B });
    expectResumeLabel(LABEL_B);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REVERT-PROOF anchor for #85 — the dashboard in-place deck patch.
// (The #87 anchor lives in the "static memoized card" describe above.)
// Removing useDashboard's patchDeckOffset call makes THIS assertion fail:
// at T+0 the hero's Continue popover falls back to the stale onDeck offset A.
// ═══════════════════════════════════════════════════════════════════════════
describe("revert-proof: useDashboard in-place deck patch is load-bearing (#85)", () => {
  it("hero Continue popover shows B at T+0 purely from the mounted-state patch", async () => {
    seedDeckCache([makeMovie(RK, A)]);
    mockGetOnDeck.mockResolvedValue([makeMovie(RK, A)]); // refetch can't save it
    await mountAndSettle(<HeroContinueSurface />);

    emitStop(RK, { viewOffsetMs: B });
    expect(mockGetOnDeck).not.toHaveBeenCalled();

    clickPlay(screen.getByRole("button", { name: /Continue/ }));
    expectResumeLabel(LABEL_B); // fails if patchDeckOffset is removed
  });
});
