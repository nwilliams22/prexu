import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEpisodeNavigation } from "./useEpisodeNavigation";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const getItemMetadata = vi.fn();
const getNextEpisode = vi.fn();
const getPreviousEpisode = vi.fn();
vi.mock("../../services/plex-library", () => ({
  getItemMetadata: (...a: unknown[]) => getItemMetadata(...a),
  getNextEpisode: (...a: unknown[]) => getNextEpisode(...a),
  getPreviousEpisode: (...a: unknown[]) => getPreviousEpisode(...a),
}));

const server = { uri: "http://server.test", accessToken: "tok" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useEpisodeNavigation", () => {
  it("navigates to the /play/:key route (not the non-existent /player/) for next episode", async () => {
    getItemMetadata.mockResolvedValue({ ratingKey: "100", type: "episode" });
    getPreviousEpisode.mockResolvedValue(null);
    getNextEpisode.mockResolvedValue({ ratingKey: "101", type: "episode" });

    const { result } = renderHook(() =>
      useEpisodeNavigation(server, "100", "episode"),
    );

    await waitFor(() => expect(result.current.handleNextEpisode).toBeDefined());
    act(() => {
      result.current.handleNextEpisode!();
    });

    expect(mockNavigate).toHaveBeenCalledWith("/play/101");
  });

  it("navigates to the /play/:key route for previous episode", async () => {
    getItemMetadata.mockResolvedValue({ ratingKey: "100", type: "episode" });
    getPreviousEpisode.mockResolvedValue({ ratingKey: "99", type: "episode" });
    getNextEpisode.mockResolvedValue(null);

    const { result } = renderHook(() =>
      useEpisodeNavigation(server, "100", "episode"),
    );

    await waitFor(() => expect(result.current.handlePrevEpisode).toBeDefined());
    act(() => {
      result.current.handlePrevEpisode!();
    });

    expect(mockNavigate).toHaveBeenCalledWith("/play/99");
  });

  it("returns undefined handlers for non-episode items", () => {
    const { result } = renderHook(() =>
      useEpisodeNavigation(server, "1", "movie"),
    );
    expect(result.current.handleNextEpisode).toBeUndefined();
    expect(result.current.handlePrevEpisode).toBeUndefined();
  });
});
