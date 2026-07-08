import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDetailItems } from "./useDetailItems";
import { emitWatchStateChanged } from "../services/watch-state-events";
import type { PaginatedResult, PlexMediaItem } from "../types/library";

const stableServer = { uri: "https://plex.test", accessToken: "token" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: stableServer }),
}));

interface Meta {
  ratingKey: string;
  title: string;
}

function makeItem(ratingKey: string): PlexMediaItem {
  return { ratingKey, title: `Item ${ratingKey}`, type: "movie" } as PlexMediaItem;
}

function makeResult(items: PlexMediaItem[]): PaginatedResult<PlexMediaItem> {
  return { items, totalSize: items.length, offset: 0, hasMore: false };
}

/** Wrapper providing a QueryClient with retries disabled for deterministic tests. */
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useDetailItems", () => {
  const fetchMetadata = vi.fn();
  const fetchItems = vi.fn();

  function render(containerKey: string | undefined) {
    return renderHook(
      () =>
        useDetailItems<Meta, PlexMediaItem>({
          containerKey,
          queryKey: "test-detail",
          fetchMetadata,
          fetchItems,
        }),
      { wrapper: makeWrapper() },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in a loading state", () => {
    fetchMetadata.mockReturnValue(new Promise(() => {}));
    fetchItems.mockReturnValue(new Promise(() => {}));

    const { result } = render("c1");

    expect(result.current.isLoading).toBe(true);
    expect(result.current.metadata).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it("returns metadata and items on success", async () => {
    fetchMetadata.mockResolvedValue({ ratingKey: "c1", title: "My Collection" });
    fetchItems.mockResolvedValue(makeResult([makeItem("1"), makeItem("2")]));

    const { result } = render("c1");

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.metadata).toEqual({
      ratingKey: "c1",
      title: "My Collection",
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.totalSize).toBe(2);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetchMetadata).toHaveBeenCalledWith(stableServer, "c1");
    expect(fetchItems).toHaveBeenCalledWith(stableServer, "c1");
  });

  it("surfaces an error when the items query fails", async () => {
    fetchMetadata.mockResolvedValue({ ratingKey: "c1", title: "My Collection" });
    fetchItems.mockRejectedValue(new Error("boom"));

    const { result } = render("c1");

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe("boom");
    expect(result.current.items).toEqual([]);
  });

  it("reports an empty container with no error", async () => {
    fetchMetadata.mockResolvedValue({ ratingKey: "c1", title: "Empty" });
    fetchItems.mockResolvedValue(makeResult([]));

    const { result } = render("c1");

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toEqual([]);
    expect(result.current.totalSize).toBe(0);
    expect(result.current.isError).toBe(false);
  });

  it("does not fetch when containerKey is undefined", () => {
    const { result } = render(undefined);

    expect(result.current.isLoading).toBe(false);
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(fetchItems).not.toHaveBeenCalled();
  });

  it("refetches items when a watch-state change targets an item in the container", async () => {
    fetchMetadata.mockResolvedValue({ ratingKey: "c1", title: "My Collection" });
    fetchItems.mockResolvedValue(makeResult([makeItem("1"), makeItem("2")]));

    const { result } = render("c1");
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchItems).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitWatchStateChanged("1", { viewOffsetMs: 0, reset: true });
    });

    // The invalidation refetches the (mounted, observed) items query, so the
    // row's watched/progress state is refreshed instead of staying stale.
    await waitFor(() => expect(fetchItems).toHaveBeenCalledTimes(2));
  });

  it("ignores watch-state changes for items not in the container", async () => {
    fetchMetadata.mockResolvedValue({ ratingKey: "c1", title: "My Collection" });
    fetchItems.mockResolvedValue(makeResult([makeItem("1")]));

    const { result } = render("c1");
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchItems).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitWatchStateChanged("999", { viewOffsetMs: 0, reset: true });
    });

    expect(fetchItems).toHaveBeenCalledTimes(1);
  });
});
