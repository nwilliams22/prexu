import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DiscoverDetail from "./DiscoverDetail";

const mockUseAsyncData = vi.fn();
const mockRefresh = vi.fn();

vi.mock("../hooks/useAsyncData", () => ({
  useAsyncData: (...args: unknown[]) => mockUseAsyncData(...args),
}));

vi.mock("../services/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/tmdb")>()),
  isTmdbAvailable: vi.fn().mockResolvedValue(true),
  getTmdbMovieDetail: vi.fn(),
  getTmdbTvDetail: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/discover/movie/123"]}>
      <Routes>
        <Route path="/discover/:mediaType/:tmdbId" element={<DiscoverDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DiscoverDetail loading/error (prexu-0szx.17)", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing before the pre-show delay elapses while loading", () => {
    vi.useFakeTimers();
    mockUseAsyncData.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refresh: mockRefresh,
    });

    const { container } = renderPage();
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(container.querySelectorAll(".shimmer").length).toBe(0);
  });

  it("shows a skeleton once the pre-show delay elapses while still loading", () => {
    vi.useFakeTimers();
    mockUseAsyncData.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refresh: mockRefresh,
    });

    const { container } = renderPage();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(container.querySelectorAll(".shimmer").length).toBeGreaterThan(0);
  });

  it("shows an ErrorState with a working Retry button on error", () => {
    mockUseAsyncData.mockReturnValue({
      data: null,
      isLoading: false,
      error: "Movie not found.",
      refresh: mockRefresh,
    });

    renderPage();

    expect(screen.getByText("Movie not found.")).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: /retry/i });
    act(() => {
      retryButton.click();
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
