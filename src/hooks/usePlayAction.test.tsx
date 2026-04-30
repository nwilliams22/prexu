import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { usePlayAction } from "./usePlayAction";
import type { PlexMediaItem } from "../types/library";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("./useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://plex.test", accessToken: "token" },
  }),
}));

const mockGetItemMetadata = vi.fn();
vi.mock("../services/plex-library", () => ({
  getItemMetadata: (...args: unknown[]) => mockGetItemMetadata(...args),
}));

function makeMovie(overrides: Partial<PlexMediaItem & { viewOffset?: number }> = {}) {
  return {
    ratingKey: "1",
    title: "Test Movie",
    type: "movie",
    thumb: "/t",
    addedAt: 0,
    ...overrides,
  } as PlexMediaItem;
}

function makeClickEvent(): React.MouseEvent {
  return {
    stopPropagation: vi.fn(),
    clientX: 100,
    clientY: 200,
  } as unknown as React.MouseEvent;
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe("usePlayAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses cached viewOffset to show ResumePopover instantly without fetching", async () => {
    const { result } = renderHook(() => usePlayAction(), { wrapper });
    const item = makeMovie({ viewOffset: 60_000 });

    const handler = result.current.getPlayHandler(item);
    expect(handler).toBeDefined();

    act(() => {
      handler!(makeClickEvent());
    });

    // No network call should have happened
    expect(mockGetItemMetadata).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    // Popover content should now be present
    expect(result.current.playOverlay).not.toBeNull();
  });

  it("navigates immediately when no cached offset and metadata says viewOffset=0", async () => {
    mockGetItemMetadata.mockResolvedValue({ viewOffset: 0 });
    const { result } = renderHook(() => usePlayAction(), { wrapper });
    const item = makeMovie({ viewOffset: 0 });

    act(() => {
      result.current.getPlayHandler(item)!(makeClickEvent());
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/play/1");
    });
  });

  it("shows loading popover during fetch when no cached offset is present", () => {
    let resolveMeta: (val: unknown) => void = () => {};
    mockGetItemMetadata.mockReturnValue(
      new Promise((resolve) => {
        resolveMeta = resolve;
      }),
    );

    const { result } = renderHook(() => usePlayAction(), { wrapper });
    const item = makeMovie({ viewOffset: 0 });

    act(() => {
      result.current.getPlayHandler(item)!(makeClickEvent());
    });

    // While fetch is pending, an overlay should be rendered (the loading state)
    expect(result.current.playOverlay).not.toBeNull();

    // Drain the pending promise to keep test runner clean
    act(() => {
      resolveMeta({ viewOffset: 0 });
    });
  });

  it("falls back to direct navigation when getItemMetadata throws", async () => {
    mockGetItemMetadata.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => usePlayAction(), { wrapper });
    const item = makeMovie({ viewOffset: 0 });

    act(() => {
      result.current.getPlayHandler(item)!(makeClickEvent());
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/play/1");
    });
  });

  it("returns undefined for non-playable item types", () => {
    const { result } = renderHook(() => usePlayAction(), { wrapper });
    const showItem = makeMovie({ type: "show" });
    expect(result.current.getPlayHandler(showItem)).toBeUndefined();
  });
});
