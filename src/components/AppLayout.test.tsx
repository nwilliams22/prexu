import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import AppLayout from "./AppLayout";
import { PLAYER_EXIT_SPINNER_MS } from "../hooks/useRouteTransitionSpinner";

// This suite exercises the REAL useRouteTransitionSpinner hook (not mocked)
// end to end through AppLayout — the point of prexu-xb3h is that the
// full-page transition overlay must never activate for an ordinary
// detail -> dashboard back-navigation, only for the /play/:ratingKey exit
// gap. Every other AppLayout dependency is mocked to keep the render cheap
// and deterministic.

vi.mock("../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    serverSelected: true,
    server: { uri: "https://plex.test", accessToken: "token" },
  }),
}));

vi.mock("../hooks/player/usePlayerLayerStyle", () => ({
  usePlayerLayerStyle: () => ({}),
}));

const mockUsePreferences = vi.fn();
vi.mock("../hooks/usePreferences", () => ({
  usePreferences: () => mockUsePreferences(),
}));

vi.mock("../hooks/useTheme", () => ({
  useThemeEffect: () => {},
}));

vi.mock("../hooks/useWatchSync", () => ({
  useWatchSync: () => {},
}));

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => "desktop",
  isMobile: (bp: string) => bp === "mobile",
  isTabletOrBelow: (bp: string) => bp === "mobile" || bp === "tablet",
  isDesktopOrAbove: (bp: string) => bp === "desktop" || bp === "large",
}));

vi.mock("../hooks/useFocusTrap", () => ({
  useFocusTrap: () => {},
}));

vi.mock("../hooks/useRouteAnnouncer", () => ({
  useRouteAnnouncer: () => {},
}));

vi.mock("../hooks/useNewContent", () => ({
  useNewContent: () => ({ newSections: [], markSectionSeen: vi.fn() }),
}));

vi.mock("./Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock("./NavButtons", () => ({ default: () => <div data-testid="nav-buttons" /> }));
vi.mock("./SearchBar", () => ({ default: () => <div data-testid="search-bar" /> }));
vi.mock("./UserSwitcher", () => ({ default: () => <div data-testid="user-switcher" /> }));
vi.mock("./RequestBell", () => ({ default: () => <div data-testid="request-bell" /> }));
vi.mock("./ActivityButton", () => ({ default: () => <div data-testid="activity-button" /> }));
vi.mock("./InviteNotification", () => ({ default: () => null }));
vi.mock("./BottomNav", () => ({ default: () => null }));
vi.mock("./ErrorBoundary", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function ItemDetailStub() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate("/")}>Back to dashboard</button>
  );
}

function PlayBridgeStub() {
  const navigate = useNavigate();
  // Mirrors PlayBridge.tsx: replaces history away from /play/:id in an
  // effect after mount, while rendering nothing itself — the
  // transition-spinner-worthy gap.
  useEffect(() => {
    navigate("/", { replace: true });
  }, [navigate]);
  return null;
}

function DashboardStub() {
  return <div data-testid="dashboard-stub">Dashboard</div>;
}

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/item/:id" element={<ItemDetailStub />} />
          <Route path="/play/:id" element={<PlayBridgeStub />} />
          <Route index element={<DashboardStub />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppLayout — route transition overlay (prexu-xb3h)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePreferences.mockReturnValue({
      preferences: {
        appearance: { theme: "dark", sidebarCollapsed: false },
      },
      updatePreferences: vi.fn(),
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never renders the transition overlay on detail -> dashboard back-nav, even well past any timer ceiling", () => {
    renderAt("/item/123");
    fireEvent.click(screen.getByRole("button", { name: /back to dashboard/i }));

    expect(screen.getByTestId("dashboard-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("route-transition-spinner")).not.toBeInTheDocument();

    // Simulate a congested main thread stretching well past the old
    // 150ms pre-show delay + 300ms ceiling — the overlay must stay absent.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("route-transition-spinner")).not.toBeInTheDocument();
  });

  it("still shows the overlay immediately when leaving /play/:ratingKey, then hides after the exit hold", () => {
    renderAt("/play/123");

    // PlayBridgeStub replaces history synchronously on mount — the overlay
    // must be showing with no pre-show delay for this case.
    expect(screen.getByTestId("route-transition-spinner")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(PLAYER_EXIT_SPINNER_MS - 1);
    });
    expect(screen.getByTestId("route-transition-spinner")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("route-transition-spinner")).not.toBeInTheDocument();
  });
});
