/**
 * Regression tests for prexu-0szx.14.
 *
 * completionCounter used to live in the same memoized ServerActivityContext
 * value as the fast-churning `sessions`/`activities` arrays. Any consumer
 * that only cares about completionCounter (useDashboard) still re-rendered
 * on every session update, because useContext re-renders on ANY change to
 * the provided value object regardless of which fields a component actually
 * reads. The fix mirrors the existing scanningIds pattern: the counter lives
 * in its own external store, and `useCompletionCounter()` subscribes to it
 * directly via useSyncExternalStore — completely bypassing ServerActivityContext.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import { memo, useContext } from "react";
import {
  createCompletionCounterStore,
  CompletionCounterStoreProvider,
  useCompletionCounter,
  ServerActivityContext,
  type CompletionCounterStore,
  type ServerActivityValue,
} from "./useServerActivity";
import type { PlexSession } from "../services/plex-activity";

// ── createCompletionCounterStore unit tests ──

describe("createCompletionCounterStore", () => {
  it("starts at 0", () => {
    const store = createCompletionCounterStore();
    expect(store.getSnapshot()).toBe(0);
  });

  it("increments and notifies subscribers", () => {
    const store = createCompletionCounterStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.increment();
    expect(store.getSnapshot()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);

    store.increment();
    expect(store.getSnapshot()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stops notifications", () => {
    const store = createCompletionCounterStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.increment();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(1);
  });
});

// ── useCompletionCounter() ──

let counterRenderCount = 0;
const CounterOnlyConsumer = memo(function CounterOnlyConsumer() {
  counterRenderCount++;
  const counter = useCompletionCounter();
  return <div data-testid="counter">{counter}</div>;
});

let fullContextRenderCount = 0;
const FullContextConsumer = memo(function FullContextConsumer() {
  fullContextRenderCount++;
  const activity = useContext(ServerActivityContext);
  return <div data-testid="full">{activity.sessions.length}</div>;
});

describe("useCompletionCounter (prexu-0szx.14)", () => {
  let store: CompletionCounterStore;

  beforeEach(() => {
    store = createCompletionCounterStore();
    counterRenderCount = 0;
    fullContextRenderCount = 0;
  });

  it("returns 0 without a provider (noop default store)", () => {
    render(<CounterOnlyConsumer />);
    expect(screen.getByTestId("counter").textContent).toBe("0");
  });

  it("reflects the store's current value and updates on increment", () => {
    render(
      <CompletionCounterStoreProvider value={store}>
        <CounterOnlyConsumer />
      </CompletionCounterStoreProvider>,
    );
    expect(screen.getByTestId("counter").textContent).toBe("0");

    act(() => {
      store.increment();
    });
    expect(screen.getByTestId("counter").textContent).toBe("1");
  });

  it("a completionCounter-only consumer does NOT re-render when the ServerActivityContext value changes (session churn)", () => {
    let contextValue: ServerActivityValue = {
      activities: [],
      sessions: [],
      isActive: false,
      completionCounter: 0,
      scanningIds: new Set(),
    };

    function Harness({ value }: { value: ServerActivityValue }) {
      return (
        <CompletionCounterStoreProvider value={store}>
          <ServerActivityContext.Provider value={value}>
            <CounterOnlyConsumer />
            <FullContextConsumer />
          </ServerActivityContext.Provider>
        </CompletionCounterStoreProvider>
      );
    }

    const { rerender } = render(<Harness value={contextValue} />);
    expect(counterRenderCount).toBe(1);
    expect(fullContextRenderCount).toBe(1);

    // Simulate session churn — a NEW ServerActivityContext value (as would
    // happen on every "playing" WebSocket notification), completionCounter
    // unchanged.
    contextValue = { ...contextValue, sessions: [{} as PlexSession] };
    rerender(<Harness value={contextValue} />);

    // The full-context consumer re-renders (expected — it reads `sessions`,
    // it's the "renders on everything" consumer). The counter-only consumer
    // must NOT — that's the whole point of the isolation.
    expect(fullContextRenderCount).toBe(2);
    expect(counterRenderCount).toBe(1);

    // Bumping the counter DOES re-render the counter-only consumer.
    act(() => {
      store.increment();
    });
    expect(counterRenderCount).toBe(2);
    expect(screen.getByTestId("counter").textContent).toBe("1");
  });
});
