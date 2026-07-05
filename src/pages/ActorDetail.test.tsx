import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ActorDetail from "./ActorDetail";

const mockTmdb = vi.fn();
const mockPlex = vi.fn();
const mockCollaborators = vi.fn();

vi.mock("../hooks/useTmdbPersonData", () => ({
  useTmdbPersonData: (...args: unknown[]) => mockTmdb(...args),
}));
vi.mock("../hooks/usePlexActorMedia", () => ({
  usePlexActorMedia: (...args: unknown[]) => mockPlex(...args),
}));
vi.mock("../hooks/useFrequentCollaborators", () => ({
  useFrequentCollaborators: (...args: unknown[]) => mockCollaborators(...args),
}));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ server: { uri: "https://server:32400", accessToken: "tok" } }),
}));
vi.mock("../hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => {},
}));
vi.mock("../services/plex-library", () => ({
  getImageUrl: () => "",
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/actor/Some%20Actor"]}>
      <Routes>
        <Route path="/actor/:actorName" element={<ActorDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

const EMPTY_PLEX = {
  movies: [],
  shows: [],
  serverItemMap: new Map(),
  isLoading: false,
  error: null,
};

const EMPTY_TMDB = {
  personDetail: null,
  credits: [],
  knownFor: [],
  isLoading: false,
  error: null,
};

describe("ActorDetail loading/error/retry (prexu-0szx.17)", () => {
  beforeEach(() => {
    mockCollaborators.mockReturnValue([]);
    mockTmdb.mockReset();
    mockPlex.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an ErrorState with a Retry button when a data hook errors", () => {
    mockTmdb.mockReturnValue({ ...EMPTY_TMDB, error: "Failed to load TMDb data" });
    mockPlex.mockReturnValue(EMPTY_PLEX);

    renderPage();

    expect(screen.getByText("Failed to load TMDb data")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("remounts the data hooks (forcing a full refetch) when Retry is clicked", async () => {
    mockTmdb.mockReturnValue({ ...EMPTY_TMDB, error: "boom" });
    mockPlex.mockReturnValue(EMPTY_PLEX);

    renderPage();
    const callsBefore = mockTmdb.mock.calls.length;

    act(() => {
      screen.getByRole("button", { name: /retry/i }).click();
    });

    await waitFor(() => {
      expect(mockTmdb.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it("does not show the loading skeleton before the pre-show delay elapses", () => {
    vi.useFakeTimers();
    mockTmdb.mockReturnValue({ ...EMPTY_TMDB, isLoading: true });
    mockPlex.mockReturnValue(EMPTY_PLEX);

    const { container } = renderPage();
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(container.querySelectorAll(".shimmer").length).toBe(0);
  });

  it("shows the loading skeleton once the pre-show delay elapses while still loading", () => {
    vi.useFakeTimers();
    mockTmdb.mockReturnValue({ ...EMPTY_TMDB, isLoading: true });
    mockPlex.mockReturnValue(EMPTY_PLEX);

    const { container } = renderPage();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(container.querySelectorAll(".shimmer").length).toBeGreaterThan(0);
  });
});
