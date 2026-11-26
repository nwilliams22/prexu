import { render, screen } from "@testing-library/react";
import WatchTogetherMediaDetails from "./WatchTogetherMediaDetails";
const { metadata } = vi.hoisted(() => ({ metadata: vi.fn() }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ server: { uri: "http://qa.test", accessToken: "test" } }) }));
vi.mock("../services/plex-library", () => ({ getItemMetadata: metadata, getImageUrl: () => "http://qa.test/poster" }));
it("shows the selected episode context and summary", async () => {
  metadata.mockResolvedValue({ type: "episode", grandparentTitle: "QA Seasons", parentIndex: 2, index: 3, duration: 60000, thumb: "/thumb", summary: "Episode fixture" });
  render(<WatchTogetherMediaDetails ratingKey="17" />);
  expect(await screen.findByText("QA Seasons · S2 E3 · 1 min")).toBeInTheDocument();
  expect(screen.getByText("Episode fixture")).toBeInTheDocument();
  expect(metadata).toHaveBeenCalledWith("http://qa.test", "test", "17");
});
