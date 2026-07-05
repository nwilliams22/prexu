import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStableItemCallback } from "./useStableItemCallback";

describe("useStableItemCallback", () => {
  it("returns the same handler for the same key across renders", () => {
    const { result, rerender } = renderHook(() =>
      useStableItemCallback<{ id: string }, () => void>(),
    );
    const run = vi.fn();

    const first = result.current("a", { id: "a" }, run);
    rerender();
    const second = result.current("a", { id: "a" }, run);

    expect(second).toBe(first);
  });

  it("returns different handlers for different keys", () => {
    const { result } = renderHook(() =>
      useStableItemCallback<{ id: string }, () => void>(),
    );
    const run = vi.fn();

    const a = result.current("a", { id: "a" }, run);
    const b = result.current("b", { id: "b" }, run);

    expect(a).not.toBe(b);
  });

  it("invokes `run` with the LATEST value even though the handler identity is stable", () => {
    const { result, rerender } = renderHook(() =>
      useStableItemCallback<{ count: number }, () => void>(),
    );
    const run = vi.fn();

    const handler = result.current("a", { count: 1 }, run);
    rerender();
    // Parent re-renders with fresh data for the same key.
    const sameHandler = result.current("a", { count: 2 }, run);
    expect(sameHandler).toBe(handler);

    handler();
    expect(run).toHaveBeenCalledWith({ count: 2 });
  });

  it("forwards call-time arguments (e.g. a MouseEvent) to `run`", () => {
    const { result } = renderHook(() =>
      useStableItemCallback<{ id: string }, (e: { x: number }) => void>(),
    );
    const run = vi.fn();
    const handler = result.current("a", { id: "a" }, run);

    handler({ x: 42 });
    expect(run).toHaveBeenCalledWith({ id: "a" }, { x: 42 });
  });
});
