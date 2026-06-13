/**
 * Render-count tests for the per-key scanning subscription (prexu-bgz.15).
 *
 * The old wiring read `scanningIds` off the ServerActivity context, so any
 * scanning change re-rendered EVERY mounted PosterCard. The fix moves the
 * scanning set into an external store and subscribes per-key through
 * `useIsScanning(ratingKey)` (useSyncExternalStore with a boolean
 * snapshot) — a card re-renders only when ITS OWN scanning state flips.
 *
 * Two layers of proof:
 *  - Minimal memoized consumers with explicit render counters
 *    (pattern from PlayerControls.tickrender.test.tsx).
 *  - Real memoized PosterCards wrapped in <Profiler>, asserting only the
 *    scanned card's subtree commits.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { memo, Profiler } from "react";
import { render, act, screen } from "@testing-library/react";
import {
  createScanningStore,
  ScanningStoreProvider,
  useIsScanning,
  type ScanningStore,
} from "../hooks/useServerActivity";
import PosterCard from "./PosterCard";

// ── Render counters ──────────────────────────────────────────────────────

const renderCounts: Record<string, number> = {};

const ScanCell = memo(function ScanCell({ ratingKey }: { ratingKey: string }) {
  renderCounts[ratingKey] = (renderCounts[ratingKey] ?? 0) + 1;
  const scanning = useIsScanning(ratingKey);
  return (
    <div data-testid={`cell-${ratingKey}`} data-scanning={String(scanning)} />
  );
});

const NoKeyCell = memo(function NoKeyCell() {
  renderCounts["nokey"] = (renderCounts["nokey"] ?? 0) + 1;
  const scanning = useIsScanning(undefined);
  return <div data-testid="cell-nokey" data-scanning={String(scanning)} />;
});

let store: ScanningStore;

beforeEach(() => {
  for (const k of Object.keys(renderCounts)) delete renderCounts[k];
  store = createScanningStore();
});

describe("useIsScanning per-key subscription (prexu-bgz.15)", () => {
  it("re-renders only the consumer whose key flips", () => {
    render(
      <ScanningStoreProvider value={store}>
        <ScanCell ratingKey="10" />
        <ScanCell ratingKey="20" />
      </ScanningStoreProvider>,
    );

    expect(renderCounts["10"]).toBe(1);
    expect(renderCounts["20"]).toBe(1);
    expect(screen.getByTestId("cell-10").dataset.scanning).toBe("false");

    // Flip scanning ON for key 10 → only cell-10 re-renders.
    act(() => {
      store.add("10");
    });
    expect(screen.getByTestId("cell-10").dataset.scanning).toBe("true");
    expect(screen.getByTestId("cell-20").dataset.scanning).toBe("false");
    expect(renderCounts["10"]).toBe(2);
    expect(renderCounts["20"]).toBe(1);

    // Unrelated key churn → NEITHER consumer re-renders.
    act(() => {
      store.add("999");
    });
    act(() => {
      store.remove("999");
    });
    expect(renderCounts["10"]).toBe(2);
    expect(renderCounts["20"]).toBe(1);

    // Flip scanning OFF for key 10 → only cell-10 re-renders again.
    act(() => {
      store.remove("10");
    });
    expect(screen.getByTestId("cell-10").dataset.scanning).toBe("false");
    expect(renderCounts["10"]).toBe(3);
    expect(renderCounts["20"]).toBe(1);
  });

  it("re-adding an already-scanning id does not notify or re-render", () => {
    render(
      <ScanningStoreProvider value={store}>
        <ScanCell ratingKey="10" />
      </ScanningStoreProvider>,
    );

    act(() => {
      store.add("10");
    });
    expect(renderCounts["10"]).toBe(2);

    // Duplicate add (timeline notifications repeat for the same item).
    act(() => {
      store.add("10");
    });
    expect(renderCounts["10"]).toBe(2);
  });

  it("returns false without a provider (noop default store)", () => {
    render(<ScanCell ratingKey="10" />);
    expect(screen.getByTestId("cell-10").dataset.scanning).toBe("false");
  });

  it("treats a missing ratingKey as never scanning", () => {
    render(
      <ScanningStoreProvider value={store}>
        <NoKeyCell />
      </ScanningStoreProvider>,
    );

    act(() => {
      store.add("anything");
    });
    expect(screen.getByTestId("cell-nokey").dataset.scanning).toBe("false");
    expect(renderCounts["nokey"]).toBe(1);
  });
});

describe("PosterCard scanning re-render isolation (prexu-bgz.15)", () => {
  it("only the scanned card's subtree commits; the sibling stays memoized", () => {
    const commits: Record<string, number> = { A: 0, B: 0 };

    const { container } = render(
      <ScanningStoreProvider value={store}>
        <Profiler id="A" onRender={() => commits.A++}>
          <div data-testid="wrap-a">
            <PosterCard imageUrl="/a.jpg" title="Card A" ratingKey="1" />
          </div>
        </Profiler>
        <Profiler id="B" onRender={() => commits.B++}>
          <div data-testid="wrap-b">
            <PosterCard imageUrl="/b.jpg" title="Card B" ratingKey="2" />
          </div>
        </Profiler>
      </ScanningStoreProvider>,
    );

    expect(commits.A).toBeGreaterThan(0);
    expect(commits.B).toBeGreaterThan(0);
    expect(container.querySelectorAll(".scan-overlay").length).toBe(0);

    const aBefore = commits.A;
    const bBefore = commits.B;

    // Card A's item starts scanning.
    act(() => {
      store.add("1");
    });

    // Overlay appears on card A only…
    expect(
      screen.getByTestId("wrap-a").querySelector(".scan-overlay"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("wrap-b").querySelector(".scan-overlay"),
    ).toBeNull();
    // …and card B's memoized subtree never re-rendered.
    expect(commits.A).toBeGreaterThan(aBefore);
    expect(commits.B).toBe(bBefore);

    // Scan ends → overlay clears, B still untouched.
    act(() => {
      store.remove("1");
    });
    expect(container.querySelectorAll(".scan-overlay").length).toBe(0);
    expect(commits.B).toBe(bBefore);
  });

  it("explicit scanning prop still wins over the store", () => {
    const { container } = render(
      <ScanningStoreProvider value={store}>
        <PosterCard imageUrl="/a.jpg" title="Card A" ratingKey="1" scanning />
      </ScanningStoreProvider>,
    );
    expect(container.querySelector(".scan-overlay")).not.toBeNull();
  });
});
