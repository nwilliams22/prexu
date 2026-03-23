import { renderHook, act, waitFor } from "@testing-library/react";
import { useParentalControlsState } from "./useParentalControls";

vi.mock("../services/storage", () => ({
  getParentalControls: vi.fn(),
  saveParentalControls: vi.fn(),
}));

import * as storage from "../services/storage";
const mockStorage = vi.mocked(storage);

describe("useParentalControlsState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getParentalControls.mockResolvedValue({
      enabled: false,
      maxContentRating: "none",
    });
    mockStorage.saveParentalControls.mockResolvedValue(undefined);
  });

  it("starts with restrictions disabled", () => {
    const { result } = renderHook(() => useParentalControlsState());
    expect(result.current.restrictionsEnabled).toBe(false);
    expect(result.current.maxContentRating).toBe("none");
  });

  it("loads settings when userId is provided", async () => {
    mockStorage.getParentalControls.mockResolvedValue({
      enabled: true,
      maxContentRating: "PG-13",
    });

    const { result } = renderHook(() => useParentalControlsState(42));

    await waitFor(() => {
      expect(result.current.restrictionsEnabled).toBe(true);
    });

    expect(result.current.maxContentRating).toBe("PG-13");
    expect(mockStorage.getParentalControls).toHaveBeenCalledWith(42);
  });

  it("filterByRating passes all items when disabled", () => {
    const { result } = renderHook(() => useParentalControlsState());

    const items = [
      { title: "Kids Movie", contentRating: "G" },
      { title: "R Movie", contentRating: "R" },
    ];

    expect(result.current.filterByRating(items)).toHaveLength(2);
  });

  it("filterByRating filters items when enabled", async () => {
    mockStorage.getParentalControls.mockResolvedValue({
      enabled: true,
      maxContentRating: "PG",
    });

    const { result } = renderHook(() => useParentalControlsState(1));

    await waitFor(() => {
      expect(result.current.restrictionsEnabled).toBe(true);
    });

    const items = [
      { title: "Kids Movie", contentRating: "G" },
      { title: "Family Movie", contentRating: "PG" },
      { title: "Teen Movie", contentRating: "PG-13" },
      { title: "Adult Movie", contentRating: "R" },
    ];

    const filtered = result.current.filterByRating(items);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((i) => i.title)).toEqual(["Kids Movie", "Family Movie"]);
  });

  it("isItemAllowed checks individual items", async () => {
    mockStorage.getParentalControls.mockResolvedValue({
      enabled: true,
      maxContentRating: "PG-13",
    });

    const { result } = renderHook(() => useParentalControlsState(1));

    await waitFor(() => {
      expect(result.current.restrictionsEnabled).toBe(true);
    });

    expect(result.current.isItemAllowed("G")).toBe(true);
    expect(result.current.isItemAllowed("PG-13")).toBe(true);
    expect(result.current.isItemAllowed("R")).toBe(false);
  });

  it("saveForUser saves and updates state for active user", async () => {
    const { result } = renderHook(() => useParentalControlsState(42));

    await act(async () => {
      await result.current.saveForUser(42, {
        enabled: true,
        maxContentRating: "PG",
      });
    });

    expect(mockStorage.saveParentalControls).toHaveBeenCalledWith(42, {
      enabled: true,
      maxContentRating: "PG",
    });
  });

  it("resets to defaults when userId becomes null", async () => {
    mockStorage.getParentalControls.mockResolvedValue({
      enabled: true,
      maxContentRating: "PG",
    });

    const { result, rerender } = renderHook(
      ({ userId }) => useParentalControlsState(userId),
      { initialProps: { userId: 42 as number | null } },
    );

    await waitFor(() => {
      expect(result.current.restrictionsEnabled).toBe(true);
    });

    rerender({ userId: null });

    expect(result.current.restrictionsEnabled).toBe(false);
    expect(result.current.maxContentRating).toBe("none");
  });
});
