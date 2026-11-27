import { act, renderHook, waitFor } from "@testing-library/react";
import { useNextEpisodeDetection } from "./useNextEpisodeDetection";
const { metadata, next } = vi.hoisted(() => ({ metadata: vi.fn(), next: vi.fn() }));
vi.mock("../../services/plex-library", () => ({ getItemMetadata: metadata, getNextEpisode: next }));
const server = { uri: "https://qa.invalid", accessToken: "test" };
beforeEach(() => { vi.clearAllMocks(); metadata.mockImplementation(async (_u, _t, key) => ({ type: "episode", ratingKey: key })); });
it("looks up each episode and clears the predecessor on transition", async () => {
  next.mockResolvedValueOnce({ ratingKey: "19" }).mockResolvedValueOnce({ ratingKey: "20" });
  const { result, rerender } = renderHook(({ key }) => useNextEpisodeDetection(true, true, server, key), { initialProps: { key: "18" } });
  await waitFor(() => expect(result.current?.ratingKey).toBe("19"));
  rerender({ key: "19" });
  expect(result.current).toBeNull();
  await waitFor(() => expect(result.current?.ratingKey).toBe("20"));
  expect(next).toHaveBeenCalledTimes(2);
});
it("ignores a previous episode lookup that finishes late", async () => {
  let resolveOld: (value: unknown) => void = () => {};
  next.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce({ ratingKey: "21" });
  const { result, rerender } = renderHook(({ key }) => useNextEpisodeDetection(true, true, server, key), { initialProps: { key: "18" } });
  await waitFor(() => expect(next).toHaveBeenCalledOnce());
  rerender({ key: "20" });
  await waitFor(() => expect(result.current?.ratingKey).toBe("21"));
  await act(async () => resolveOld({ ratingKey: "19" }));
  expect(result.current?.ratingKey).toBe("21");
});
