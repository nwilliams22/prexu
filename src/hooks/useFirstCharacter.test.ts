/**
 * Tests for useFirstCharacter hook and computeLetterOffsets utility.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useFirstCharacter, computeLetterOffsets } from "./useFirstCharacter";

const stableServer = { uri: "https://plex.test", accessToken: "token" };
vi.mock("./useAuth", () => ({
  useAuth: () => ({ server: stableServer }),
}));

const mockCacheGet = vi.fn(() => null);
const mockCacheSet = vi.fn();
vi.mock("../services/api-cache", () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheInvalidate: vi.fn(),
}));

const mockGetSectionFirstCharacter = vi.fn();
vi.mock("../services/plex-library", () => ({
  getSectionFirstCharacter: (...args: unknown[]) =>
    mockGetSectionFirstCharacter(...args),
}));

vi.mock("../services/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

const SECTION_ID = "1";

function makeBuckets() {
  return [
    { key: "#", size: 3 },
    { key: "A", size: 10 },
    { key: "B", size: 5 },
    { key: "Z", size: 1 },
  ];
}

describe("useFirstCharacter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockGetSectionFirstCharacter.mockResolvedValue(makeBuckets());
  });

  it("returns empty state when enabled is false", () => {
    const { result } = renderHook(() =>
      useFirstCharacter(SECTION_ID, false)
    );

    expect(result.current.buckets).toEqual([]);
    expect(result.current.letters.size).toBe(0);
    expect(result.current.isLoading).toBe(false);
    expect(mockGetSectionFirstCharacter).not.toHaveBeenCalled();
  });

  it("returns empty state when sectionId is undefined", () => {
    const { result } = renderHook(() =>
      useFirstCharacter(undefined, true)
    );

    expect(result.current.buckets).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mockGetSectionFirstCharacter).not.toHaveBeenCalled();
  });

  it("fetches and returns buckets when enabled", async () => {
    const { result } = renderHook(() =>
      useFirstCharacter(SECTION_ID, true)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetSectionFirstCharacter).toHaveBeenCalledWith(
      "https://plex.test",
      "token",
      SECTION_ID
    );
    expect(result.current.buckets).toEqual(makeBuckets());
  });

  it("derives letters set from non-zero-sized buckets", async () => {
    mockGetSectionFirstCharacter.mockResolvedValue([
      { key: "#", size: 3 },
      { key: "A", size: 0 },   // zero — should NOT appear in letters
      { key: "B", size: 5 },
    ]);

    const { result } = renderHook(() =>
      useFirstCharacter(SECTION_ID, true)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.letters.has("#")).toBe(true);
    expect(result.current.letters.has("A")).toBe(false);
    expect(result.current.letters.has("B")).toBe(true);
  });

  it("serves from cache when available", () => {
    const cached = makeBuckets();
    mockCacheGet.mockReturnValue(cached);

    const { result } = renderHook(() =>
      useFirstCharacter(SECTION_ID, true)
    );

    expect(result.current.buckets).toEqual(cached);
    expect(result.current.isLoading).toBe(false);
    expect(mockGetSectionFirstCharacter).not.toHaveBeenCalled();
  });

  it("caches fetched result", async () => {
    const { result } = renderHook(() =>
      useFirstCharacter(SECTION_ID, true)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockCacheSet).toHaveBeenCalledWith(
      expect.stringContaining(`firstCharacter.v2:https://plex.test:${SECTION_ID}`),
      makeBuckets(),
      expect.any(Number)
    );
  });

  it("sets error and returns empty buckets on fetch failure", async () => {
    mockGetSectionFirstCharacter.mockRejectedValue(new Error("API error"));

    const { result } = renderHook(() =>
      useFirstCharacter(SECTION_ID, true)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("API error");
    expect(result.current.buckets).toEqual([]);
    expect(result.current.letters.size).toBe(0);
  });

  it("includes # in letters set when service returns normalized # buckets", async () => {
    mockGetSectionFirstCharacter.mockResolvedValue([
      { key: "#", size: 5 },
      { key: "A", size: 10 },
    ]);

    const { result } = renderHook(() =>
      useFirstCharacter(SECTION_ID, true)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.letters.has("#")).toBe(true);
    expect(result.current.letters.has("A")).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("computeLetterOffsets", () => {
  it("returns empty map for empty buckets", () => {
    const offsets = computeLetterOffsets([]);
    expect(offsets.size).toBe(0);
  });

  it("assigns offset 0 to the first bucket", () => {
    const offsets = computeLetterOffsets([
      { key: "#", size: 3 },
      { key: "A", size: 10 },
    ]);
    expect(offsets.get("#")).toBe(0);
  });

  it("cumulates offsets across buckets in order", () => {
    const offsets = computeLetterOffsets([
      { key: "#", size: 3 },
      { key: "A", size: 10 },
      { key: "B", size: 5 },
      { key: "Z", size: 1 },
    ]);
    expect(offsets.get("#")).toBe(0);
    expect(offsets.get("A")).toBe(3);
    expect(offsets.get("B")).toBe(13);
    expect(offsets.get("Z")).toBe(18);
  });

  it("handles single-bucket sections", () => {
    const offsets = computeLetterOffsets([{ key: "A", size: 500 }]);
    expect(offsets.get("A")).toBe(0);
    expect(offsets.size).toBe(1);
  });

  it("handles buckets with size 0 correctly (gap-free cumulation)", () => {
    // A zero-size bucket still gets an offset, but adds nothing to cursor
    const offsets = computeLetterOffsets([
      { key: "A", size: 5 },
      { key: "B", size: 0 },
      { key: "C", size: 3 },
    ]);
    expect(offsets.get("A")).toBe(0);
    expect(offsets.get("B")).toBe(5);
    expect(offsets.get("C")).toBe(5);
  });

  it("each offset corresponds to the first item index for that letter", () => {
    // Library has 100 items: 0-9 start with "#", 10-29 start with "A", 30-99 with "B"
    const offsets = computeLetterOffsets([
      { key: "#", size: 10 },
      { key: "A", size: 20 },
      { key: "B", size: 70 },
    ]);
    // scrollToIndex(offsets.get("A")) should land on item 10 — the first "A"
    expect(offsets.get("A")).toBe(10);
    expect(offsets.get("B")).toBe(30);
  });
});
