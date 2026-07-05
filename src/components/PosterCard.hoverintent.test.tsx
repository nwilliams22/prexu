/**
 * Hover-intent prefetch behavior (prexu-0szx.15): onHoverIntent fires with
 * the card's ratingKey only after a SUSTAINED (150ms) hover or focus —
 * sweeping the cursor across a shelf must not fan out prefetches.
 */

import { render, fireEvent, act } from "@testing-library/react";
import PosterCard from "./PosterCard";

const HOVER_INTENT_DELAY_MS = 150;

function renderCard(props: Partial<React.ComponentProps<typeof PosterCard>> = {}) {
  const utils = render(
    <PosterCard imageUrl="/poster.jpg" title="Inception" ratingKey="42" {...props} />,
  );
  const card = utils.getByRole("button", { name: /inception/i });
  return { ...utils, card };
}

describe("PosterCard hover-intent prefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onHoverIntent with the ratingKey after sustained hover", () => {
    const onHoverIntent = vi.fn();
    const { card } = renderCard({ onHoverIntent });

    fireEvent.mouseEnter(card);
    expect(onHoverIntent).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS));
    expect(onHoverIntent).toHaveBeenCalledExactlyOnceWith("42");
  });

  it("does not fire when the cursor leaves before the intent delay", () => {
    const onHoverIntent = vi.fn();
    const { card } = renderCard({ onHoverIntent });

    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS - 50));
    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(1000));

    expect(onHoverIntent).not.toHaveBeenCalled();
  });

  it("fires only once per hover session, but re-arms on re-enter", () => {
    const onHoverIntent = vi.fn();
    const { card } = renderCard({ onHoverIntent });

    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(5000));
    expect(onHoverIntent).toHaveBeenCalledTimes(1);

    fireEvent.mouseLeave(card);
    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS));
    expect(onHoverIntent).toHaveBeenCalledTimes(2);
  });

  it("fires after sustained keyboard focus", () => {
    const onHoverIntent = vi.fn();
    const { card } = renderCard({ onHoverIntent });

    fireEvent.focus(card);
    act(() => vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS));

    expect(onHoverIntent).toHaveBeenCalledExactlyOnceWith("42");
  });

  it("does not fire when focus is lost before the intent delay", () => {
    const onHoverIntent = vi.fn();
    const { card } = renderCard({ onHoverIntent });

    fireEvent.focus(card);
    fireEvent.blur(card);
    act(() => vi.advanceTimersByTime(1000));

    expect(onHoverIntent).not.toHaveBeenCalled();
  });

  it("does not double-fire when hover and focus overlap", () => {
    const onHoverIntent = vi.fn();
    const { card } = renderCard({ onHoverIntent });

    fireEvent.mouseEnter(card);
    fireEvent.focus(card); // same timer already armed — must not stack
    act(() => vi.advanceTimersByTime(HOVER_INTENT_DELAY_MS));

    expect(onHoverIntent).toHaveBeenCalledTimes(1);
  });

  it("never fires without a ratingKey", () => {
    const onHoverIntent = vi.fn();
    const { card } = renderCard({ onHoverIntent, ratingKey: undefined });

    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(1000));

    expect(onHoverIntent).not.toHaveBeenCalled();
  });

  it("does not fire after unmount (virtualized rows unmount mid-scroll)", () => {
    const onHoverIntent = vi.fn();
    const { card, unmount } = renderCard({ onHoverIntent });

    fireEvent.mouseEnter(card);
    unmount();
    act(() => vi.advanceTimersByTime(1000));

    expect(onHoverIntent).not.toHaveBeenCalled();
  });

  it("hover state changes never fire the intent without the prop", () => {
    // No onHoverIntent prop at all — hover must remain purely visual.
    const { card } = renderCard();
    fireEvent.mouseEnter(card);
    expect(() => act(() => vi.advanceTimersByTime(1000))).not.toThrow();
  });
});
