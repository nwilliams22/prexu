import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SkipButtons from "./SkipButtons";

function baseProps() {
  return {
    isPlaying: false,
    togglePlay: vi.fn(),
    duration: 100,
    currentTimeRef: { current: 0 },
    seekFn: vi.fn(),
    onNextEpisode: vi.fn(),
    onPrevEpisode: vi.fn(),
    onStop: vi.fn(),
    mobile: false,
    iconSmall: 22,
    iconLarge: 28,
  };
}

describe("SkipButtons responsive compaction (prexu-52ky)", () => {
  it("renders the full transport by default (no compaction flags)", () => {
    render(<SkipButtons {...baseProps()} />);
    expect(screen.getByLabelText("Previous episode")).toBeTruthy();
    expect(screen.getByLabelText("Next episode")).toBeTruthy();
    expect(screen.getByLabelText("Rewind 30 seconds")).toBeTruthy();
    expect(screen.getByLabelText("Forward 30 seconds")).toBeTruthy();
    expect(screen.getByLabelText("Stop")).toBeTruthy();
    expect(screen.getByLabelText("Play")).toBeTruthy();
    expect(screen.getByLabelText("Rewind 10 seconds")).toBeTruthy();
    expect(screen.getByLabelText("Forward 10 seconds")).toBeTruthy();
  });

  it("hides prev/next episode when hideEpisodeNav is set, keeping the rest", () => {
    render(<SkipButtons {...baseProps()} hideEpisodeNav />);
    expect(screen.queryByLabelText("Previous episode")).toBeNull();
    expect(screen.queryByLabelText("Next episode")).toBeNull();
    expect(screen.getByLabelText("Rewind 30 seconds")).toBeTruthy();
    expect(screen.getByLabelText("Forward 30 seconds")).toBeTruthy();
    expect(screen.getByLabelText("Stop")).toBeTruthy();
    expect(screen.getByLabelText("Play")).toBeTruthy();
  });

  it("hides chapter/30s skip when hideChapterNav is set, keeping episode nav", () => {
    render(<SkipButtons {...baseProps()} hideChapterNav />);
    expect(screen.queryByLabelText("Rewind 30 seconds")).toBeNull();
    expect(screen.queryByLabelText("Forward 30 seconds")).toBeNull();
    expect(screen.getByLabelText("Previous episode")).toBeTruthy();
    expect(screen.getByLabelText("Next episode")).toBeTruthy();
    expect(screen.getByLabelText("Stop")).toBeTruthy();
    expect(screen.getByLabelText("Play")).toBeTruthy();
  });

  it("at floor compaction (both flags set), only stop / 10s-skip / play-pause remain — play/pause and stop are never hidden", () => {
    render(<SkipButtons {...baseProps()} hideEpisodeNav hideChapterNav />);
    expect(screen.queryByLabelText("Previous episode")).toBeNull();
    expect(screen.queryByLabelText("Next episode")).toBeNull();
    expect(screen.queryByLabelText("Rewind 30 seconds")).toBeNull();
    expect(screen.queryByLabelText("Forward 30 seconds")).toBeNull();
    expect(screen.getByLabelText("Stop")).toBeTruthy();
    expect(screen.getByLabelText("Play")).toBeTruthy();
    expect(screen.getByLabelText("Rewind 10 seconds")).toBeTruthy();
    expect(screen.getByLabelText("Forward 10 seconds")).toBeTruthy();
  });

  it("respects chapters present — chapter labels swap in but still hide under hideChapterNav", () => {
    const chapters = [
      { tag: "Ch1", startTimeOffset: 0 } as never,
      { tag: "Ch2", startTimeOffset: 60000 } as never,
    ];
    const { rerender } = render(<SkipButtons {...baseProps()} chapters={chapters} />);
    expect(screen.getByLabelText("Previous chapter")).toBeTruthy();
    expect(screen.getByLabelText("Next chapter")).toBeTruthy();

    rerender(<SkipButtons {...baseProps()} chapters={chapters} hideChapterNav />);
    expect(screen.queryByLabelText("Previous chapter")).toBeNull();
    expect(screen.queryByLabelText("Next chapter")).toBeNull();
  });

  it("still forwards reflowTick as a data attribute on the always-mounted play/pause button (prexu-trbl regression)", () => {
    const { rerender } = render(<SkipButtons {...baseProps()} reflowTick={0} />);
    expect(screen.getByLabelText("Play").getAttribute("data-reflow-tick")).toBe("0");
    rerender(<SkipButtons {...baseProps()} reflowTick={1} hideEpisodeNav hideChapterNav />);
    expect(screen.getByLabelText("Play").getAttribute("data-reflow-tick")).toBe("1");
  });
});
