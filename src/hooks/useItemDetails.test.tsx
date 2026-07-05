import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useItemDetails } from "./useItemDetails";
import type { PlexMediaItem } from "../types/library";

const stableServer = { uri: "https://plex.test", accessToken: "token" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: stableServer }),
}));

const mockGetItemMetadata = vi.fn();
vi.mock("../services/plex-library", () => ({
  getItemMetadata: (...args: unknown[]) => mockGetItemMetadata(...args),
}));

function makeItem(ratingKey: string): PlexMediaItem {
  return {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    type: "movie",
    title: `Item ${ratingKey}`,
    summary: "",
    thumb: "",
    art: "",
    addedAt: 0,
    updatedAt: 0,
  } as PlexMediaItem;
}

/** Fresh QueryClient per test (retries disabled for determinism). */
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useItemDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the SAME Map reference across re-renders when no query state changed", async () => {
    const resolvers = new Map<string, (val: unknown) => void>();
    mockGetItemMetadata.mockImplementation(
      (_uri: string, _token: string, ratingKey: string) =>
        new Promise((resolve) => { resolvers.set(ratingKey, resolve); }),
    );

    const items = [makeItem("1"), makeItem("2")];
    const { result, rerender } = renderHook(
      ({ items }: { items: PlexMediaItem[] }) => useItemDetails(items),
      { wrapper: makeWrapper(), initialProps: { items } },
    );

    const firstMap = result.current.details;

    // Re-render with the SAME items array (as a parent component would do
    // on an unrelated state change) — before the fix, useQueries' fresh
    // array wrapper caused a brand-new Map every render regardless.
    rerender({ items });
    expect(result.current.details).toBe(firstMap);

    rerender({ items });
    expect(result.current.details).toBe(firstMap);

    // Resolve the pending query — Map identity SHOULD now change, but only
    // once (when the underlying query data actually changes).
    await act(async () => {
      resolvers.get("1")?.({ ratingKey: "1", title: "Item 1", type: "movie" });
    });

    await waitFor(() => {
      expect(result.current.details).not.toBe(firstMap);
    });
    expect(result.current.details.get("1")).toEqual(
      expect.objectContaining({ ratingKey: "1" }),
    );

    const resolvedMap = result.current.details;
    rerender({ items });
    expect(result.current.details).toBe(resolvedMap);
  });

  it("reports pendingKeys only for items whose query hasn't resolved yet", async () => {
    mockGetItemMetadata.mockImplementation((_uri: string, _token: string, ratingKey: string) => {
      if (ratingKey === "1") return Promise.resolve({ ratingKey: "1", title: "Item 1", type: "movie" });
      return new Promise(() => {}); // never resolves
    });

    const items = [makeItem("1"), makeItem("2")];
    const { result } = renderHook(() => useItemDetails(items), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.details.has("1")).toBe(true);
    });

    expect(result.current.pendingKeys.has("1")).toBe(false);
    expect(result.current.pendingKeys.has("2")).toBe(true);
    expect(result.current.isLoading).toBe(true);
  });

  it("gates fetching to only the items passed in (visible-window gating)", () => {
    mockGetItemMetadata.mockReturnValue(new Promise(() => {}));
    const allItems = [makeItem("1"), makeItem("2"), makeItem("3")];
    // Simulates a virtualized caller passing only the visible subset.
    const visibleOnly = [allItems[1]!];

    renderHook(() => useItemDetails(visibleOnly), { wrapper: makeWrapper() });

    expect(mockGetItemMetadata).toHaveBeenCalledTimes(1);
    expect(mockGetItemMetadata).toHaveBeenCalledWith(
      stableServer.uri,
      stableServer.accessToken,
      "2",
    );
  });
});
