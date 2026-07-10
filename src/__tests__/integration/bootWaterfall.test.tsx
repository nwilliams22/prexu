/**
 * W4 — Boot/auth waterfall integration suite (prexu-pd1x.4).
 *
 * The App-level boot gate (App.tsx `AppRoutes` + the real `useAuthState`
 * "boot waterfall") had ZERO tests. The three failure modes the manual test
 * plan lists as hardware-only (docs/test-automation-plan.md H.1–H.3) all live
 * in the SEAM between the async auth resolve, the splash-dismissal quorum, and
 * the `{isLoading ? null : <Routes>}` login-flash gate — none of which any unit
 * test exercises. This suite mounts the REAL `<App/>` (real useAuthState →
 * real AuthProvider → real AppRoutes → real SplashScreen + real route guards)
 * and drives the boot to assert what the user actually sees:
 *
 *   • Splash quorum      — dismiss once ≥2 of 3 dashboard sections settle,
 *                          a single stalled section never strands the user,
 *                          an outright sections failure dismisses immediately.
 *   • Hard cap           — after HARD_CAP_MS (20s) the splash dismisses no
 *                          matter what; and the cap is CANCELLED (no bogus
 *                          "hard cap reached" warning) when quorum won first.
 *   • Login-flash gate   — Routes render nothing but the splash while auth is
 *                          still resolving; a valid token boots straight to the
 *                          app shell and the Login page is NEVER rendered (H.1).
 *   • Revoked token      — an invalid stored token routes to Login with NO
 *                          dashboard flash (H.3).
 *   • Offline launch     — an unreachable stored server still boots to the app
 *                          shell (optimistic restore) with no login flash and
 *                          no stuck splash; surfaces the unreachable banner
 *                          instead of a half-auth state (H.2).
 *   • Splash staging     — the 700ms minimum-display floor is honoured even on
 *                          an instant-ready boot; an in-progress update blocks
 *                          dismissal entirely.
 *
 * Only the true boundaries are faked: storage, plex.tv validation, server
 * reachability, the Tauri `invoke`, and `prefetchDashboardData` (returned as a
 * controllable deferred handle so the quorum can be driven section-by-section).
 * The heavy authenticated shell is out of scope for the boot gate, so the page
 * leaves are lightweight markers and AppLayout is a faithful reproduction of
 * its real auth guard (AppLayout.tsx:152-153) — page render-spies double as
 * flash detectors.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AuthData, ServerData } from "../../types/plex";
import type { DashboardPrefetchHandle } from "../../utils/dashboardPrefetch";
import { createServerData } from "../mocks/plex-data";

// ── Page render-spies (hoisted so the mock factories below can reference them) ─
// Each spy fires on that page's FIRST render, so "was the Login page ever put
// on screen?" becomes `spies.loginRendered` call count — a flash detector.
const spies = vi.hoisted(() => ({
  loginRendered: vi.fn(),
  serversRendered: vi.fn(),
  dashboardRendered: vi.fn(),
}));

// ── Boundary mocks ────────────────────────────────────────────────────────
// Tauri IPC: App fires invoke("app_ready") on mount.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Persistent storage — the stored-token/server the boot reads.
vi.mock("../../services/storage", () => ({
  getAuth: vi.fn(),
  getServer: vi.fn(),
  getActiveUser: vi.fn(),
  getAdminAuth: vi.fn(),
  clearAuth: vi.fn().mockResolvedValue(undefined),
  saveAuth: vi.fn().mockResolvedValue(undefined),
  saveServer: vi.fn().mockResolvedValue(undefined),
  clearServer: vi.fn().mockResolvedValue(undefined),
  saveAdminAuth: vi.fn().mockResolvedValue(undefined),
  saveActiveUser: vi.fn().mockResolvedValue(undefined),
  getClientIdentifier: vi.fn().mockResolvedValue("test-client-id"),
  migrateToSecureStorage: vi.fn().mockResolvedValue(undefined),
}));

// plex.tv token validation — the boolean that gates authenticated boot.
vi.mock("../../services/plex-api", () => ({
  validateToken: vi.fn(),
  getPlexUser: vi.fn(),
  onAuthInvalid: vi.fn().mockReturnValue(() => {}),
  discoverServers: vi.fn().mockResolvedValue([]),
}));

// Background reachability probe — kept off Tauri; controls the offline path.
vi.mock("../../services/server-reachability", () => ({
  probeServerReachability: vi.fn().mockResolvedValue(true),
  resolveServerFromDiscovery: vi.fn().mockReturnValue(null),
  logServerResolve: vi.fn(),
}));

// Logger — spy the methods (assert the hard-cap warning) but keep redactUrl
// real (useAuthState's offline re-resolve path calls it).
vi.mock("../../services/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/logger")>();
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    },
  };
});

// The parallel prefetch source — returned as a controllable deferred handle so
// each test drives the quorum section-by-section (see makeHandle).
vi.mock("../../utils/dashboardPrefetch", () => ({
  prefetchDashboardData: vi.fn(),
  __resetDashboardPrefetchForTests: vi.fn(),
}));

// Auto-updater — feeds SplashScreen's `updating` prop; default: no update.
vi.mock("../../hooks/useAutoUpdate", () => ({
  useAutoUpdate: vi.fn(() => ({ installing: false, downloadProgress: null })),
}));

// The provider stack + authenticated shell are out of scope for the boot gate.
// AppProviders → passthrough; AppLayout → a faithful copy of its real auth
// guard (AppLayout.tsx:152-153) so the "no dashboard flash on revoked token"
// contract is exercised without dragging in the sidebar/hooks tree.
vi.mock("../../contexts/AppProviders", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../components/AppLayout", async () => {
  const { Navigate, Outlet } = await import("react-router-dom");
  const { useAuth } = await import("../../hooks/useAuth");
  return {
    default: function MockAppLayout() {
      const { isAuthenticated, serverSelected } = useAuth();
      if (!isAuthenticated) return <Navigate to="/login" replace />;
      if (!serverSelected) return <Navigate to="/servers" replace />;
      return (
        <div data-testid="app-shell">
          <Outlet />
        </div>
      );
    },
  };
});
vi.mock("../../components/PlayerOverlay", () => ({ default: () => null }));
vi.mock("../../components/PlayBridge", () => ({ default: () => null }));

// Lazy route leaves — markers that ping a render-spy. Only the three the boot
// gate can reach (/, /login, /servers) need faking.
vi.mock("../../pages/Login", () => ({
  default: () => {
    spies.loginRendered();
    return <div data-testid="login-page">LOGIN</div>;
  },
}));
vi.mock("../../pages/ServerSelect", () => ({
  default: () => {
    spies.serversRendered();
    return <div data-testid="servers-page">SERVERS</div>;
  },
}));
vi.mock("../../pages/Dashboard", () => ({
  default: () => {
    spies.dashboardRendered();
    return <div data-testid="dashboard-page">DASHBOARD</div>;
  },
}));

import App from "../../App";
import * as storage from "../../services/storage";
import * as plexApi from "../../services/plex-api";
import * as reachability from "../../services/server-reachability";
import { logger } from "../../services/logger";
import { prefetchDashboardData } from "../../utils/dashboardPrefetch";
import { useAutoUpdate } from "../../hooks/useAutoUpdate";

const mockStorage = vi.mocked(storage);
const mockPlexApi = vi.mocked(plexApi);
const mockReach = vi.mocked(reachability);
const mockLogger = vi.mocked(logger);
const mockPrefetch = vi.mocked(prefetchDashboardData);
const mockAutoUpdate = vi.mocked(useAutoUpdate);

// ── Fixtures & helpers ────────────────────────────────────────────────────
const SERVER: ServerData = createServerData({ uri: "https://plex.test:32400" });
const STORED_AUTH: AuthData = { authToken: "stored-token", clientIdentifier: "cid" };

/** A prefetch handle whose four settle-promises are resolved on demand — the
 *  test knob for driving the splash quorum. Mirrors the real handle contract:
 *  the promises resolve (never reject); `sectionsSettled` carries a boolean. */
function makeHandle() {
  let resolveMovies!: () => void;
  let resolveShows!: () => void;
  let resolveDeck!: () => void;
  let resolveSections!: (ok: boolean) => void;
  const handle: DashboardPrefetchHandle = {
    sectionsSettled: new Promise<boolean>((r) => (resolveSections = r)),
    movies: new Promise<void>((r) => (resolveMovies = r)),
    shows: new Promise<void>((r) => (resolveShows = r)),
    deck: new Promise<void>((r) => (resolveDeck = r)),
  };
  return { handle, resolveMovies, resolveShows, resolveDeck, resolveSections };
}

/** Advance fake time (and flush the microtasks it releases) inside act(). */
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Drain the async boot chain (migrate → getAuth → validate → Promise.all →
 *  setState → effects → lazy-route import) without moving the clock. */
async function settleBoot() {
  for (let i = 0; i < 10; i++) await advance(0);
}

function renderApp(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

/** The splash renders its "Prexu" wordmark until it is fully hidden. */
function splashVisible() {
  return screen.queryByText("Prexu") !== null;
}

function setupValidAuth() {
  mockStorage.getAuth.mockResolvedValue(STORED_AUTH);
  mockStorage.getServer.mockResolvedValue(SERVER);
  mockPlexApi.validateToken.mockResolvedValue(true);
}

describe("boot/auth waterfall (W4 · pd1x.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Defaults: no stored auth, token invalid, server reachable, no update.
    mockStorage.getAuth.mockResolvedValue(null);
    mockStorage.getServer.mockResolvedValue(null);
    mockStorage.getActiveUser.mockResolvedValue(null);
    mockStorage.getAdminAuth.mockResolvedValue(null);
    mockStorage.clearAuth.mockResolvedValue(undefined);
    mockStorage.getClientIdentifier.mockResolvedValue("test-client-id");
    mockStorage.migrateToSecureStorage.mockResolvedValue(undefined);
    mockPlexApi.validateToken.mockResolvedValue(false);
    mockPlexApi.onAuthInvalid.mockReturnValue(() => {});
    mockPlexApi.discoverServers.mockResolvedValue([]);
    mockReach.probeServerReachability.mockResolvedValue(true);
    mockReach.resolveServerFromDiscovery.mockReturnValue(null);
    mockAutoUpdate.mockReturnValue({ installing: false, downloadProgress: null });
    // Default handle: nothing settles (tests that care install their own).
    mockPrefetch.mockReturnValue(makeHandle().handle);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ── Splash quorum ────────────────────────────────────────────────────────
  describe("splash quorum", () => {
    it("dismisses the splash once a quorum (2 of 3) of sections settle — and NOT after only one", async () => {
      setupValidAuth();
      const h = makeHandle();
      mockPrefetch.mockReturnValue(h.handle);

      renderApp();
      await settleBoot();
      expect(splashVisible()).toBe(true);

      // One section settled — still below the quorum of 2.
      await act(async () => {
        h.resolveMovies();
      });
      await advance(2000);
      expect(splashVisible()).toBe(true);

      // Second section settled — quorum reached, splash dismisses after the
      // floor + fade.
      await act(async () => {
        h.resolveShows();
      });
      await advance(1100);
      expect(splashVisible()).toBe(false);
    });

    it("a single stalled section never strands the user — quorum of the other two dismisses it", async () => {
      setupValidAuth();
      const h = makeHandle();
      mockPrefetch.mockReturnValue(h.handle);

      renderApp();
      await settleBoot();

      // `shows` hangs forever; movies + deck still reach quorum.
      await act(async () => {
        h.resolveMovies();
        h.resolveDeck();
      });
      await advance(1100);
      expect(splashVisible()).toBe(false);
    });

    it("dismisses immediately when the sections fetch fails outright (no quorum possible)", async () => {
      setupValidAuth();
      const h = makeHandle();
      mockPrefetch.mockReturnValue(h.handle);

      renderApp();
      await settleBoot();
      expect(splashVisible()).toBe(true);

      // Sections failed → sectionsSettled resolves false → dismiss.
      await act(async () => {
        h.resolveSections(false);
      });
      await advance(1100);
      expect(splashVisible()).toBe(false);
    });
  });

  // ── Hard cap ───────────────────────────────────────────────────────────
  describe("hard cap", () => {
    it("dismisses the splash after HARD_CAP_MS when no quorum is reached", async () => {
      setupValidAuth();
      mockPrefetch.mockReturnValue(makeHandle().handle); // nothing ever settles

      renderApp();
      await settleBoot();

      // Just before the 20s cap: still stranded on the splash.
      await advance(19_999);
      expect(splashVisible()).toBe(true);
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        "splash",
        "hard cap reached, dismissing",
        expect.anything(),
      );

      // Cross the cap → warn + dismiss (fade/hide over the following 400ms).
      await advance(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "splash",
        "hard cap reached, dismissing",
        { capMs: 20000 },
      );
      await advance(400);
      expect(splashVisible()).toBe(false);
    });

    it("cancels the hard cap (no bogus warning) when quorum dismissed the splash first", async () => {
      setupValidAuth();
      const h = makeHandle();
      mockPrefetch.mockReturnValue(h.handle);

      renderApp();
      await settleBoot();

      await act(async () => {
        h.resolveMovies();
        h.resolveShows();
      });
      await advance(1100);
      expect(splashVisible()).toBe(false);

      // Long after the (now-cancelled) cap would have fired.
      await advance(20_000);
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        "splash",
        "hard cap reached, dismissing",
        expect.anything(),
      );
    });
  });

  // ── Login-flash gate ───────────────────────────────────────────────────
  describe("login-flash gate", () => {
    it("renders nothing but the splash while auth is still resolving", async () => {
      // getAuth never resolves → isLoading stays true → the gate holds.
      mockStorage.getAuth.mockReturnValue(new Promise<AuthData | null>(() => {}));

      renderApp();
      await settleBoot();

      expect(splashVisible()).toBe(true);
      expect(screen.queryByTestId("login-page")).toBeNull();
      expect(screen.queryByTestId("dashboard-page")).toBeNull();
      expect(spies.loginRendered).not.toHaveBeenCalled();
    });

    it("boots a valid token straight to the app shell with no login flash", async () => {
      setupValidAuth();

      renderApp();
      await settleBoot();

      expect(screen.getByTestId("app-shell")).toBeTruthy();
      expect(screen.getByTestId("dashboard-page")).toBeTruthy();
      // The Login page was never mounted at any point during the boot.
      expect(spies.loginRendered).not.toHaveBeenCalled();
    });
  });

  // ── Revoked token (H.3) ────────────────────────────────────────────────
  describe("revoked stored token", () => {
    it("routes to Login with no dashboard flash", async () => {
      // Real timers for this one: the assertion is about the redirect →
      // lazy-Login chain (an AppLayout <Navigate> hop that React Router
      // drives on a scheduler macrotask the fake-timer clock doesn't turn),
      // not about splash timing — so findBy under real timers is the honest
      // way to observe the routed outcome.
      vi.useRealTimers();
      mockStorage.getAuth.mockResolvedValue(STORED_AUTH);
      mockStorage.getServer.mockResolvedValue(SERVER);
      mockPlexApi.validateToken.mockResolvedValue(false); // revoked

      renderApp();

      expect(await screen.findByTestId("login-page")).toBeTruthy();
      expect(screen.queryByTestId("dashboard-page")).toBeNull();
      // Never a flash of the authenticated dashboard.
      expect(spies.dashboardRendered).not.toHaveBeenCalled();
      // The stale token was purged.
      expect(mockStorage.clearAuth).toHaveBeenCalled();
    });
  });

  // ── Offline launch (H.2) ───────────────────────────────────────────────
  describe("offline launch", () => {
    it("boots to the app shell when the stored server is unreachable — no login flash, no half-auth", async () => {
      setupValidAuth();
      // Probe fails and re-resolve finds nothing → serverUnreachable.
      mockReach.probeServerReachability.mockResolvedValue(false);
      mockReach.resolveServerFromDiscovery.mockReturnValue(null);

      renderApp();
      await settleBoot();

      // Optimistic restore keeps the user in the authenticated shell...
      expect(screen.getByTestId("app-shell")).toBeTruthy();
      expect(spies.loginRendered).not.toHaveBeenCalled();
      // ...with the unreachable banner surfaced instead of a login bounce.
      expect(screen.getByRole("alert")).toHaveTextContent("Server unreachable");
    });
  });

  // ── Splash staging ─────────────────────────────────────────────────────
  describe("splash staging", () => {
    it("honours the 700ms minimum-display floor even when ready fires immediately", async () => {
      // No stored auth → AppRoutes marks appReady immediately (login shows).
      renderApp();
      await settleBoot();

      // Still on the splash floor at 699ms despite instant readiness.
      await advance(699);
      expect(splashVisible()).toBe(true);

      // Past the floor + fade → dismissed.
      await advance(401);
      expect(splashVisible()).toBe(false);
    });

    it("blocks splash dismissal while an update is installing", async () => {
      mockAutoUpdate.mockReturnValue({ installing: true, downloadProgress: 42 });
      setupValidAuth();
      const h = makeHandle();
      mockPrefetch.mockReturnValue(h.handle);

      renderApp();
      await settleBoot();

      // Quorum reached AND well past the hard cap — but the install pins it.
      await act(async () => {
        h.resolveMovies();
        h.resolveShows();
      });
      await advance(25_000);
      expect(splashVisible()).toBe(true);
      expect(screen.getByText("Installing update...")).toBeTruthy();
    });
  });
});
