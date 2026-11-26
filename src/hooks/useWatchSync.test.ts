import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mark: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/plex-library", () => ({ markAsWatched: mocks.mark }));
vi.mock("../services/storage", () => ({ getPendingWatchSync: async () => [{ ratingKey: "2", watchedAt: 1234 }], removePendingWatchSync: mocks.remove }));
import { useWatchSync } from "./useWatchSync";
it("preserves the original watch time when synchronizing a previous session", async () => {
  renderHook(() => useWatchSync({ uri: "https://qa.invalid", accessToken: "test" }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("2"));
  expect(mocks.mark).toHaveBeenCalledWith("https://qa.invalid", "test", "2", 1234);
});
