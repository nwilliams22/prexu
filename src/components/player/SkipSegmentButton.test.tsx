import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import SkipSegmentButton from "./SkipSegmentButton";
import type { ActiveSegment } from "../../hooks/player/useSkipSegments";

const introSegment: ActiveSegment = { type: "intro", start: 0, end: 90 };
const creditsSegment: ActiveSegment = { type: "credits", start: 3000, end: 3300 };

function renderSkip(
  overrides: Partial<React.ComponentProps<typeof SkipSegmentButton>> = {},
) {
  const props = {
    segment: introSegment,
    onSkip: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  return { ...render(<SkipSegmentButton {...props} />), props };
}

describe("SkipSegmentButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── prexu-bgz.21: input guard ──────────────────────────────────────────────

  it("calls onSkip when S is pressed on the window (no focused input)", () => {
    const { props } = renderSkip();
    fireEvent.keyDown(window, { key: "s" });
    expect(props.onSkip).toHaveBeenCalledTimes(1);
  });

  it("calls onSkip when S (uppercase) is pressed on the window", () => {
    const { props } = renderSkip();
    fireEvent.keyDown(window, { key: "S" });
    expect(props.onSkip).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onSkip when S is pressed while an <input> is the target", () => {
    const { props } = renderSkip();
    const input = document.createElement("input");
    document.body.appendChild(input);
    // Fire on the element itself so it bubbles to window with the correct target.
    fireEvent.keyDown(input, { key: "s", bubbles: true });
    expect(props.onSkip).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("does NOT call onSkip when S is pressed while a <textarea> is the target", () => {
    const { props } = renderSkip();
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    fireEvent.keyDown(textarea, { key: "s", bubbles: true });
    expect(props.onSkip).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it("does NOT call onSkip when S is pressed while a <select> is the target", () => {
    const { props } = renderSkip();
    const select = document.createElement("select");
    document.body.appendChild(select);
    fireEvent.keyDown(select, { key: "s", bubbles: true });
    expect(props.onSkip).not.toHaveBeenCalled();
    document.body.removeChild(select);
  });

  it("does NOT call onSkip when S is pressed while a contentEditable element is the target", () => {
    const { props } = renderSkip();
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    fireEvent.keyDown(div, { key: "s", bubbles: true });
    expect(props.onSkip).not.toHaveBeenCalled();
    document.body.removeChild(div);
  });

  it("does NOT call onSkip when Shift+S is pressed", () => {
    const { props } = renderSkip();
    fireEvent.keyDown(window, { key: "S", shiftKey: true });
    expect(props.onSkip).not.toHaveBeenCalled();
  });

  it("does not call onSkip for unrelated keys", () => {
    const { props } = renderSkip();
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "k" });
    expect(props.onSkip).not.toHaveBeenCalled();
  });

  // ── segment type rendering ─────────────────────────────────────────────────

  it("shows 'Skip Intro' for intro segment", () => {
    const { getByRole } = renderSkip({ segment: introSegment });
    expect(getByRole("button", { name: /skip intro/i })).toBeInTheDocument();
  });

  it("shows 'Skip Credits' for credits segment", () => {
    const { getByRole } = renderSkip({ segment: creditsSegment });
    expect(getByRole("button", { name: /skip credits/i })).toBeInTheDocument();
  });

  it("shows 'Next Episode' button for credits segment with next episode", () => {
    const { getByRole } = renderSkip({
      segment: creditsSegment,
      hasNextEpisode: true,
      onNextEpisode: vi.fn(),
    });
    expect(getByRole("button", { name: /next episode/i })).toBeInTheDocument();
  });

  it("does NOT show 'Next Episode' for intro segment even with hasNextEpisode", () => {
    const { queryByRole } = renderSkip({
      segment: introSegment,
      hasNextEpisode: true,
      onNextEpisode: vi.fn(),
    });
    expect(queryByRole("button", { name: /next episode/i })).not.toBeInTheDocument();
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const { props, getByRole } = renderSkip();
    fireEvent.click(getByRole("button", { name: /dismiss/i }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("removes the keydown listener on unmount", () => {
    const { props, unmount } = renderSkip();
    unmount();
    fireEvent.keyDown(window, { key: "s" });
    expect(props.onSkip).not.toHaveBeenCalled();
  });
});
