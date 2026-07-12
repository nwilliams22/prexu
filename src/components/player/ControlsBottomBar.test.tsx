/**
 * Responsive compaction tests for the bottom controls bar (prexu-52ky).
 *
 * jsdom performs no real layout, so "the row's width" can't come from actual
 * CSS — ControlsBottomBar measures it via a ResizeObserver on the row's DOM
 * node. These tests install a controllable ResizeObserver test double
 * (mirroring pages/Player.test.tsx's MockResizeObserver) and fire a resize
 * with the widths from the bug report / task: ~920 (hardware popout
 * physical width, no compaction expected), ~530 (hardware popout logical
 * width — the reported clipping size), ~320, and the 200 logical floor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import type { PlayerChrome } from "../../hooks/usePlayer";
import ControlsBottomBar from "./ControlsBottomBar";

vi.mock("../../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// ResizeObserver test double (same shape as pages/Player.test.tsx)
// ---------------------------------------------------------------------------
type ROCallback = (entries: ResizeObserverEntry[]) => void;

class MockResizeObserver {
  private cb: ROCallback;
  private static instances: MockResizeObserver[] = [];

  constructor(cb: ROCallback) {
    this.cb = cb;
    MockResizeObserver.instances.push(this);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  simulateResize(width: number, height = 60) {
    this.cb([{ contentRect: { width, height } as DOMRectReadOnly } as ResizeObserverEntry]);
  }

  static reset() {
    MockResizeObserver.instances = [];
  }

  static getLatest(): MockResizeObserver {
    return MockResizeObserver.instances[MockResizeObserver.instances.length - 1];
  }
}

function makePlayerChrome(overrides?: Partial<PlayerChrome>): PlayerChrome {
  return {
    isPlaying: false,
    togglePlay: vi.fn(),
    duration: 100,
    isMuted: false,
    volume: 1,
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    isFullscreen: false,
    toggleFullscreen: vi.fn(),
    selectedSubtitleId: null,
    subtitleTracks: [],
    selectSubtitleTrack: vi.fn(),
    selectedAudioId: null,
    audioTracks: [],
    selectAudioTrack: vi.fn(),
    ...overrides,
  } as unknown as PlayerChrome;
}

function baseProps(overrides?: Record<string, unknown>) {
  return {
    player: makePlayerChrome(),
    currentTimeRef: { current: 0 },
    seekFn: vi.fn(),
    mobile: false,
    onNextEpisode: vi.fn(),
    onPrevEpisode: vi.fn(),
    onStop: vi.fn(),
    isPiPSupported: true,
    onTogglePiP: vi.fn(),
    isPopOutMode: true,
    isMinimizeSupported: true,
    onMinimize: vi.fn(),
    queueCount: 2,
    onToggleQueue: vi.fn(),
    ...overrides,
  };
}

describe("ControlsBottomBar responsive compaction (prexu-52ky)", () => {
  let originalResizeObserver: typeof globalThis.ResizeObserver;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    MockResizeObserver.reset();
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  function renderAtWidth(width: number, overrides?: Record<string, unknown>) {
    const utils = render(<ControlsBottomBar {...baseProps(overrides)} />);
    act(() => {
      MockResizeObserver.getLatest().simulateResize(width);
    });
    return utils;
  }

  it("~920px (hardware popout physical width): full row, no overflow menu, nothing clipped-by-design", () => {
    renderAtWidth(920);
    expect(screen.getByLabelText("Subtitles")).toBeTruthy();
    expect(screen.getByLabelText("Audio")).toBeTruthy();
    expect(screen.getByLabelText("Playback queue")).toBeTruthy();
    expect(screen.getByLabelText("Minimize player to corner")).toBeTruthy();
    expect(screen.getByLabelText("Pop out floating player")).toBeTruthy();
    expect(screen.getByLabelText("Fullscreen")).toBeTruthy();
    expect(screen.queryByLabelText("More controls")).toBeNull();
  });

  it("~530px (hardware popout logical width — the reported bug size): secondary buttons collapse into overflow, but subtitles, pop-out and fullscreen stay inline and reachable", () => {
    renderAtWidth(530);

    // Pop-out toggle — the actual bug — MUST be directly reachable in the row.
    expect(screen.getByLabelText("Pop out floating player")).toBeTruthy();
    expect(screen.getByLabelText("Fullscreen")).toBeTruthy();
    expect(screen.getByLabelText("Subtitles")).toBeTruthy();

    // Secondary buttons no longer rendered inline...
    expect(screen.queryByLabelText("Audio")).toBeNull();
    expect(screen.queryByLabelText("Playback queue")).toBeNull();
    expect(screen.queryByLabelText("Minimize player to corner")).toBeNull();

    // ...but available via the "more" menu.
    const moreButton = screen.getByLabelText("More controls");
    expect(moreButton).toBeTruthy();
    fireEvent.click(moreButton);
    expect(screen.getByRole("menuitem", { name: /Audio/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Playback queue/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Minimize player to corner/ })).toBeTruthy();
    // Subtitles is NOT in the overflow menu at this width — still inline.
    expect(screen.queryByRole("menuitem", { name: /Subtitles/ })).toBeNull();
  });

  it("~320px: same overflow tier as 530px, plus transport extras dropped (verified in SkipButtons.test.tsx); pop-out/fullscreen/subtitles still reachable", () => {
    renderAtWidth(320);
    expect(screen.getByLabelText("Pop out floating player")).toBeTruthy();
    expect(screen.getByLabelText("Fullscreen")).toBeTruthy();
    expect(screen.getByLabelText("Subtitles")).toBeTruthy();
    expect(screen.getByLabelText("More controls")).toBeTruthy();
  });

  it("200px (logical floor): subtitles also collapses into overflow, leaving only pop-out + fullscreen + more inline — pop-out is still reachable", () => {
    renderAtWidth(200);

    expect(screen.getByLabelText("Pop out floating player")).toBeTruthy();
    expect(screen.getByLabelText("Fullscreen")).toBeTruthy();
    expect(screen.queryByLabelText("Subtitles")).toBeNull();

    const moreButton = screen.getByLabelText("More controls");
    fireEvent.click(moreButton);
    expect(screen.getByRole("menuitem", { name: /Subtitles/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Audio/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Playback queue/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Minimize player to corner/ })).toBeTruthy();
  });

  it("clicking an overflow item invokes its action and closes the menu", () => {
    const onToggleQueue = vi.fn();
    renderAtWidth(530, { onToggleQueue });
    fireEvent.click(screen.getByLabelText("More controls"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Playback queue/ }));
    expect(onToggleQueue).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("auto-closes the overflow menu when a resize back to full width removes its trigger", () => {
    renderAtWidth(530);
    fireEvent.click(screen.getByLabelText("More controls"));
    expect(screen.getByRole("menu")).toBeTruthy();

    act(() => {
      MockResizeObserver.getLatest().simulateResize(920);
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByLabelText("More controls")).toBeNull();
  });

  it("does not render an overflow menu button before the ResizeObserver has ever reported a width (unmeasured = full width)", () => {
    render(<ControlsBottomBar {...baseProps()} />);
    expect(screen.queryByLabelText("More controls")).toBeNull();
    expect(screen.getByLabelText("Subtitles")).toBeTruthy();
  });

  it("still forwards reflowTick as a data attribute on the row (prexu-trbl regression)", () => {
    const { container, rerender } = render(
      <ControlsBottomBar {...baseProps()} reflowTick={0} />,
    );
    const row = container.querySelector("[data-reflow-tick]");
    expect(row?.getAttribute("data-reflow-tick")).toBe("0");
    rerender(<ControlsBottomBar {...baseProps()} reflowTick={5} />);
    expect(container.querySelector("[data-reflow-tick]")?.getAttribute("data-reflow-tick")).toBe("5");
  });
});

describe("E.1-gate: popout button visibility (prexu-5mse)", () => {
  let originalResizeObserver: typeof globalThis.ResizeObserver;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    MockResizeObserver.reset();
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("renders the popout button when isPiPSupported is true and onTogglePiP is provided", () => {
    render(<ControlsBottomBar {...baseProps({ isPiPSupported: true, onTogglePiP: vi.fn() })} />);
    expect(screen.getByLabelText("Pop out floating player")).toBeTruthy();
  });

  it("does not render the popout button when isPiPSupported is false", () => {
    render(<ControlsBottomBar {...baseProps({ isPiPSupported: false })} />);
    expect(screen.queryByLabelText("Pop out floating player")).toBeNull();
  });

  it("does not render the popout button when onTogglePiP is undefined", () => {
    render(<ControlsBottomBar {...baseProps({ isPiPSupported: true, onTogglePiP: undefined })} />);
    expect(screen.queryByLabelText("Pop out floating player")).toBeNull();
  });
});
