import { act, cleanup, fireEvent, render } from "@testing-library/react";
import PosterCard from "./PosterCard";
import { _resetSharedObserversForTesting } from "../hooks/useLazyImage";

afterEach(() => {
  cleanup();
  _resetSharedObserversForTesting();
  vi.unstubAllGlobals();
});

it("paints a skeleton without image requests until the card intersects", () => {
  _resetSharedObserversForTesting();
  let notify!: IntersectionObserverCallback;
  let target!: Element;
  const unobserve = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe(element: Element) { target = element; }
    unobserve = unobserve;
    disconnect() {}
  });
  const { container } = render(
    <PosterCard title="Poster" imageUrl="/full.jpg" placeholderUrl="/blur.jpg" />,
  );
  expect(container.querySelector(".shimmer")).not.toBeNull();
  expect(container.querySelectorAll("img")).toHaveLength(0);
  act(() => notify([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(unobserve).toHaveBeenCalledWith(target);
  const placeholder = container.querySelector('img[src="/blur.jpg"]')!;
  const full = container.querySelector('img[src="/full.jpg"]')!;
  expect(placeholder).not.toBeNull();
  expect(full).not.toBeNull();
  fireEvent.load(placeholder);
  expect(container.querySelector(".shimmer")).toBeNull();
  fireEvent.load(full);
  expect(container.querySelector('img[src="/blur.jpg"]')).toBeNull();
});
