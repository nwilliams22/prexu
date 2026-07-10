/**
 * W7 — eof → postplay → next-item UI-chain integration suite (prexu-pd1x.7).
 *
 * The postplay/advance chain was only ever tested in pieces: `usePostPlay`
 * at the hook level (return values, stub player), `PostPlayScreen` in prop
 * isolation, and `player-postplay-gate` as pure functions. Nothing drove a
 * real player `eof` event through the real hook, the real `QueueProvider`,
 * and the mounted `<PostPlayScreen>` to the actual advance/exit outcome —
 * the seam this suite covers. It reproduces the exact Player.tsx wiring
 * (Player.tsx:337-346 advance, :387-400 usePostPlay args, :813-826 render
 * gate) in a small surface, faking only the player boundary
 * (`subscribeToEof`/`pause`) and the Plex metadata fetch.
 *
 * Retires the UI half of manual plan rows G.5 and E.1. Honours the
 * `prexu-player-no-auto-exit-countdown` memory (bead prexu-3z9): an EOF with
 * no continuation exits IMMEDIATELY — no overlay, no countdown, ever.
 *
 * Chain under test:
 *   player eof → usePostPlay handler → (a) hasNextItem → pause + PostPlay
 *   overlay → Play Now / Stop / Enter / Esc / autoplay-countdown, or
 *   (b) no next item → onExit synchronously, or (c) WT session → nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { useCallback } from "react";
import { QueueProvider, useQueue } from "../../contexts/QueueContext";
import { usePostPlay } from "../../hooks/player/usePostPlay";
import { hasNextItem } from "../../pages/player-postplay-gate";
import PostPlayScreen from "../../components/player/PostPlayScreen";
import type { UsePlayerResult } from "../../hooks/usePlayer";
import type { QueueItem, QueueSource } from "../../types/queue";

// ── Boundary mocks ────────────────────────────────────────────────────────
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));
// usePostPlay fetches enriched next-item metadata when the overlay opens.
vi.mock("../../services/plex-library", () => ({
  getItemMetadata: vi.fn().mockResolvedValue({
    summary: "next up",
    viewCount: 0,
    originallyAvailableAt: "2024-01-01",
  }),
}));

import { getItemMetadata } from "../../services/plex-library";

const SERVER = { uri: "https://plex.test", accessToken: "token" };
const QUEUE_STORAGE_KEY = "prexu_playback_queue";

// EOF handler captured from the fake player's subscribeToEof, fired by fireEof().
let eofHandler: (() => void) | null = null;

/** A UsePlayerResult stub whose subscribeToEof captures the handler so the
 *  test can drive a real eof event, and whose pause/unload are spies. */
function makePlayer(): UsePlayerResult {
  const subscribeToEof = vi.fn((handler: () => void) => {
    eofHandler = handler;
    return () => {
      eofHandler = null;
    };
  });
  return {
    videoRef: { current: null },
    title: "Now Playing",
    subtitle: "",
    isLoading: false,
    isPlaying: true,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 1,
    isMuted: false,
    isFullscreen: false,
    playbackError: null,
    chapters: [],
    markers: [],
    itemType: "episode",
    parentRatingKey: "",
    audioTracks: [],
    subtitleTracks: [],
    selectedAudioId: null,
    selectedSubtitleId: null,
    togglePlay: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    toggleFullscreen: vi.fn(),
    selectAudioTrack: vi.fn(),
    selectSubtitleTrack: vi.fn(),
    retry: vi.fn(),
    pause: vi.fn(),
    unload: vi.fn().mockResolvedValue(undefined),
    setFullscreen: vi.fn().mockResolvedValue(undefined),
    subscribeToEof,
    applySubtitleStyle: vi.fn(),
    applyAudioEnhancement: vi.fn(),
  } as unknown as UsePlayerResult;
}

function ep(n: number): QueueItem {
  return {
    ratingKey: `ep${n}`,
    title: `Episode ${n}`,
    // Subtitle text kept distinct from the title so an assertion on the
    // next-item title matches uniquely (the badge "S1 E2" + "Chapter N").
    subtitle: `S01E0${n} · Chapter ${n}`,
    thumb: `/thumb/${n}`,
    duration: 60000,
    type: "episode",
  };
}
function movie(n: number): QueueItem {
  return {
    ratingKey: `mv${n}`,
    title: `Movie ${n}`,
    subtitle: "",
    thumb: `/thumb/m${n}`,
    duration: 60000,
    type: "movie",
  };
}

/** Seed the real QueueProvider by writing the queue it loads on init. */
function seedQueue(items: QueueItem[], currentIndex: number, source: QueueSource) {
  localStorage.setItem(
    QUEUE_STORAGE_KEY,
    JSON.stringify({ items, currentIndex, source }),
  );
}

// ── The surface: production's postplay wiring, minus the heavy Player shell ─
interface SurfaceProps {
  player: UsePlayerResult;
  wtInSession?: boolean;
  isMinimized?: boolean;
  autoPlayEnabled?: boolean;
  onAdvance: (ratingKey: string) => void; // stands in for replaceRatingKey
  onExit: () => void;
  onRestoreFromMinimize?: () => void;
}

function PostPlaySurface({
  player,
  wtInSession = false,
  isMinimized = false,
  autoPlayEnabled = false,
  onAdvance,
  onExit,
  onRestoreFromMinimize = () => {},
}: SurfaceProps) {
  const { queue, playNext } = useQueue();
  const current = queue.items[queue.currentIndex];
  const ratingKey = current?.ratingKey ?? "";
  const itemType = current?.type ?? "episode";
  const hasNext = hasNextItem({
    itemType,
    ratingKey,
    queue,
    hasPlexNextEpisode: false,
  });

  // Mirrors Player.tsx handleNextEpisode (queue path): advance the real queue
  // then swap the ratingKey in place.
  const handleAdvance = useCallback(() => {
    const next = playNext();
    if (next) onAdvance(next.ratingKey);
  }, [playNext, onAdvance]);

  const postPlay = usePostPlay({
    player,
    queue,
    ratingKey,
    itemType,
    hasNextItem: hasNext,
    wtInSession,
    isMinimized,
    autoPlayEnabled,
    server: SERVER,
    onAdvanceNext: handleAdvance,
    onExit,
    onRestoreFromMinimize,
  });

  return (
    <>
      <div data-testid="current-rk">{ratingKey}</div>
      {postPlay.showPostPlay && postPlay.nextQueueItem ? (
        <PostPlayScreen
          nextItem={postPlay.nextQueueItem}
          onPlayNext={postPlay.onPlayNext}
          onStop={postPlay.onStop}
          posterUrl={(p) => p}
          autoPlayEnabled={autoPlayEnabled}
          onAutoPlayChange={() => {}}
        />
      ) : null}
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
/** Fire the captured player eof event and flush the resulting state/mount. */
async function fireEof() {
  await act(async () => {
    eofHandler?.();
  });
  await tick(0);
}
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  await tick(0);
}
async function press(key: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key });
  });
  await tick(0);
}
function renderSurface(props: SurfaceProps) {
  return render(
    <QueueProvider>
      <PostPlaySurface {...props} />
    </QueueProvider>,
  );
}
const promptShowing = () =>
  screen.queryByRole("dialog", { name: /playing next/i }) !== null;
const currentRk = () => screen.getByTestId("current-rk").textContent;

describe("eof → postplay → next-item chain (W7 · pd1x.7)", () => {
  let onAdvance: ReturnType<typeof vi.fn>;
  let onExit: ReturnType<typeof vi.fn>;
  let onRestore: ReturnType<typeof vi.fn>;
  let player: UsePlayerResult;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
    eofHandler = null;
    onAdvance = vi.fn();
    onExit = vi.fn();
    onRestore = vi.fn();
    player = makePlayer();
    vi.mocked(getItemMetadata).mockResolvedValue({
      summary: "next up",
      viewCount: 0,
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ── EOF → prompt ──────────────────────────────────────────────────────────
  it("surfaces the PostPlay prompt (and pauses the player) when an episode ends with a queued next", async () => {
    seedQueue([ep(1), ep(2)], 0, "auto-episodes");
    renderSurface({ player, onAdvance, onExit });

    expect(promptShowing()).toBe(false);
    await fireEof();

    expect(promptShowing()).toBe(true);
    expect(screen.getByText("PLAYING NEXT")).toBeTruthy();
    expect(screen.getByText("Episode 2")).toBeTruthy();
    expect(player.pause).toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  // ── Play Now → advance ────────────────────────────────────────────────────
  it("advances the real queue and dismisses the prompt when Play Now is clicked", async () => {
    seedQueue([ep(1), ep(2)], 0, "auto-episodes");
    renderSurface({ player, onAdvance, onExit });
    await fireEof();
    expect(currentRk()).toBe("ep1");

    await click("Play Now");

    expect(onAdvance).toHaveBeenCalledWith("ep2");
    expect(currentRk()).toBe("ep2"); // real QueueProvider advanced
    expect(promptShowing()).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
  });

  // ── Stop → exit ───────────────────────────────────────────────────────────
  it("exits the player and leaves the queue put when Stop is clicked", async () => {
    seedQueue([ep(1), ep(2)], 0, "auto-episodes");
    renderSurface({ player, onAdvance, onExit });
    await fireEof();

    await click("Stop");

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
    expect(currentRk()).toBe("ep1"); // queue did NOT advance
    expect(promptShowing()).toBe(false);
  });

  // ── No continuation → immediate exit, no countdown (prexu-3z9 memory) ──────
  it("exits immediately with no prompt and no countdown when a final item ends", async () => {
    // Last item in the queue → hasNextItem false.
    seedQueue([ep(1), ep(2)], 1, "auto-episodes");
    renderSurface({ player, onAdvance, onExit });

    await fireEof();

    // Synchronous exit — no overlay was ever mounted.
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(promptShowing()).toBe(false);
    expect(screen.queryByText("PLAYING NEXT")).toBeNull();
    expect(player.pause).not.toHaveBeenCalled();

    // No auto-exit countdown machinery: time passing changes nothing.
    await tick(15000);
    expect(promptShowing()).toBe(false);
    expect(onExit).toHaveBeenCalledTimes(1); // not re-fired on a timer
    expect(onAdvance).not.toHaveBeenCalled();
  });

  // ── Autoplay countdown → auto-advance ─────────────────────────────────────
  it("auto-advances via the countdown at zero when autoplay is enabled", async () => {
    seedQueue([ep(1), ep(2)], 0, "auto-episodes");
    renderSurface({ player, onAdvance, onExit, autoPlayEnabled: true });
    await fireEof();
    expect(promptShowing()).toBe(true);

    // Countdown starts at 10s; not yet fired one tick short.
    await tick(9000);
    expect(onAdvance).not.toHaveBeenCalled();

    await tick(1000);
    expect(onAdvance).toHaveBeenCalledWith("ep2");
    expect(currentRk()).toBe("ep2");
    expect(promptShowing()).toBe(false);
  });

  // ── Keyboard seam ─────────────────────────────────────────────────────────
  describe("keyboard", () => {
    it("Enter advances to the next item", async () => {
      seedQueue([ep(1), ep(2)], 0, "auto-episodes");
      renderSurface({ player, onAdvance, onExit });
      await fireEof();

      await press("Enter");

      expect(onAdvance).toHaveBeenCalledWith("ep2");
      expect(currentRk()).toBe("ep2");
      expect(onExit).not.toHaveBeenCalled();
    });

    it("Escape exits the player", async () => {
      seedQueue([ep(1), ep(2)], 0, "auto-episodes");
      renderSurface({ player, onAdvance, onExit });
      await fireEof();

      await press("Escape");

      expect(onExit).toHaveBeenCalledTimes(1);
      expect(onAdvance).not.toHaveBeenCalled();
      expect(currentRk()).toBe("ep1");
    });
  });

  // ── User-built movie queue (prexu-9yn) ────────────────────────────────────
  it("prompts and advances for a movie inside a user-built queue", async () => {
    seedQueue([movie(1), movie(2)], 0, "user-built");
    renderSurface({ player, onAdvance, onExit });

    await fireEof();
    expect(promptShowing()).toBe(true);
    expect(screen.getByText("Movie 2")).toBeTruthy();

    await click("Play Now");
    expect(onAdvance).toHaveBeenCalledWith("mv2");
    expect(currentRk()).toBe("mv2");
  });

  // ── Watch Together suppression ────────────────────────────────────────────
  it("neither prompts nor exits on EOF during a Watch Together session", async () => {
    seedQueue([ep(1), ep(2)], 0, "auto-episodes");
    renderSurface({ player, onAdvance, onExit, wtInSession: true });

    await fireEof();

    expect(promptShowing()).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();
  });
});
