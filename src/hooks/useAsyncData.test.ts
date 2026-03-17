import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAsyncData } from "./useAsyncData";

describe("useAsyncData", () => {
  it("starts in loading state", () => {
    const fetchFn = vi.fn(() => new Promise<string>(() => {})); // never resolves
    const { result } = renderHook(() => useAsyncData(fetchFn, ["key"]));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("resolves data on success", async () => {
    const fetchFn = vi.fn(() => Promise.resolve("hello"));
    const { result } = renderHook(() => useAsyncData(fetchFn, ["key"]));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBe("hello");
    expect(result.current.error).toBeNull();
  });

  it("sets error on failure", async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error("boom")));
    const { result } = renderHook(() => useAsyncData(fetchFn, ["key"]));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("boom");
  });

  it("skips fetch when a dependency is null", async () => {
    const fetchFn = vi.fn(() => Promise.resolve("data"));
    const { result } = renderHook(() => useAsyncData(fetchFn, [null]));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when deps change", async () => {
    let callCount = 0;
    const fetchFn = vi.fn(() => Promise.resolve(`call-${++callCount}`));

    const { result, rerender } = renderHook(
      ({ dep }) => useAsyncData(fetchFn, [dep]),
      { initialProps: { dep: "a" } },
    );

    await waitFor(() => expect(result.current.data).toBe("call-1"));

    rerender({ dep: "b" });

    await waitFor(() => expect(result.current.data).toBe("call-2"));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("provides isCancelled callback to fetchFn", async () => {
    let receivedIsCancelled: (() => boolean) | null = null;

    const fetchFn = vi.fn((isCancelled: () => boolean) => {
      receivedIsCancelled = isCancelled;
      return Promise.resolve("data");
    });

    renderHook(() => useAsyncData(fetchFn, ["key"]));

    await waitFor(() => {
      expect(receivedIsCancelled).not.toBeNull();
    });

    // Initially not cancelled
    expect(receivedIsCancelled!()).toBe(false);
  });
});
