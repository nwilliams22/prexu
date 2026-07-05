/**
 * useDetailPrefetch (prexu-0szx.15): stable-identity callback that warms
 * the ItemDetail cache via warmItemDetailCache with the CURRENT server.
 */

import { renderHook } from "@testing-library/react";
import { useDetailPrefetch } from "./useDetailPrefetch";

const mockWarmItemDetailCache = vi.fn(() => Promise.resolve());
vi.mock("./useItemDetailData", () => ({
  warmItemDetailCache: (...args: unknown[]) => mockWarmItemDetailCache(...args),
}));

let currentServer: { uri: string; accessToken: string } | null = {
  uri: "https://plex.test",
  accessToken: "token",
};
vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: currentServer }),
}));

describe("useDetailPrefetch", () => {
  beforeEach(() => {
    mockWarmItemDetailCache.mockClear();
    currentServer = { uri: "https://plex.test", accessToken: "token" };
  });

  it("warms the detail cache with the current server and ratingKey", () => {
    const { result } = renderHook(() => useDetailPrefetch());

    result.current("42");

    expect(mockWarmItemDetailCache).toHaveBeenCalledExactlyOnceWith(
      currentServer,
      "42",
    );
  });

  it("returns the same callback identity across re-renders (memo-safe)", () => {
    const { result, rerender } = renderHook(() => useDetailPrefetch());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("no-ops without a server", () => {
    currentServer = null;
    const { result } = renderHook(() => useDetailPrefetch());

    result.current("42");

    expect(mockWarmItemDetailCache).not.toHaveBeenCalled();
  });

  it("uses the freshest server after a server switch, same identity", () => {
    const { result, rerender } = renderHook(() => useDetailPrefetch());
    const first = result.current;

    const newServer = { uri: "https://other.test", accessToken: "token2" };
    currentServer = newServer;
    rerender();

    expect(result.current).toBe(first);
    result.current("7");
    expect(mockWarmItemDetailCache).toHaveBeenCalledExactlyOnceWith(newServer, "7");
  });
});
