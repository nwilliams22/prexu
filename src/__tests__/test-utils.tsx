/**
 * Custom render function wrapping components with all necessary providers.
 * Mirrors the App.tsx provider hierarchy:
 *   BrowserRouter > AuthProvider > HomeUsersProvider > PreferencesProvider > InviteProvider
 */

import { type ReactElement, type ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider, type AuthContextValue } from "../hooks/useAuth";
import { PreferencesProvider, type PreferencesContextValue } from "../hooks/usePreferences";
import { HomeUsersProvider, type HomeUsersContextValue } from "../hooks/useHomeUsers";
import { InviteProvider, type InviteContextValue } from "../hooks/useInvites";
import { createServerData, createActiveUser, createPreferences } from "./mocks/plex-data";
import type { Preferences } from "../types/preferences";

// ── Mock context value factories ──

export function createMockAuth(
  overrides: Partial<AuthContextValue> = {}
): AuthContextValue {
  return {
    isLoading: false,
    isAuthenticated: true,
    serverSelected: true,
    authToken: "test-auth-token",
    server: createServerData(),
    activeUser: createActiveUser({ isAdmin: true }),
    login: vi.fn(),
    logout: vi.fn(),
    selectServer: vi.fn(),
    changeServer: vi.fn(),
    switchUser: vi.fn(),
    ...overrides,
  };
}

export function createMockPreferences(
  overrides: Partial<PreferencesContextValue> = {},
  prefsOverrides: Partial<Preferences> = {}
): PreferencesContextValue {
  return {
    preferences: createPreferences(prefsOverrides),
    updatePreferences: vi.fn(),
    resetPreferences: vi.fn(),
    ...overrides,
  };
}

export function createMockHomeUsers(
  overrides: Partial<HomeUsersContextValue> = {}
): HomeUsersContextValue {
  return {
    homeUsers: [],
    isLoading: false,
    isPlexHome: false,
    isSwitching: false,
    switchError: null,
    switchTo: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
}

export function createMockInvites(
  overrides: Partial<InviteContextValue> = {}
): InviteContextValue {
  return {
    invites: [],
    isRelayConnected: false,
    connectToRelay: vi.fn(),
    dismissInvite: vi.fn(),
    refreshInvites: vi.fn(),
    ...overrides,
  };
}

// ── Provider wrapper options ──

interface ProviderOptions {
  auth?: Partial<AuthContextValue>;
  preferences?: Partial<PreferencesContextValue>;
  homeUsers?: Partial<HomeUsersContextValue>;
  invites?: Partial<InviteContextValue>;
  /** Set to false to skip BrowserRouter (e.g. if test provides its own) */
  withRouter?: boolean;
}

function AllProviders({
  children,
  options = {},
}: {
  children: ReactNode;
  options?: ProviderOptions;
}) {
  const auth = createMockAuth(options.auth);
  const prefs = createMockPreferences(options.preferences);
  const homeUsers = createMockHomeUsers(options.homeUsers);
  const invites = createMockInvites(options.invites);

  const tree = (
    <AuthProvider value={auth}>
      <HomeUsersProvider value={homeUsers}>
        <PreferencesProvider value={prefs}>
          <InviteProvider value={invites}>
            {children}
          </InviteProvider>
        </PreferencesProvider>
      </HomeUsersProvider>
    </AuthProvider>
  );

  if (options.withRouter === false) return tree;
  return <BrowserRouter>{tree}</BrowserRouter>;
}

// ── Custom render ──

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  providerOptions?: ProviderOptions;
}

/**
 * Render a component wrapped in all app providers with sensible defaults.
 *
 * @example
 * ```ts
 * const { getByText } = renderWithProviders(<MyComponent />, {
 *   providerOptions: { auth: { isAuthenticated: false } }
 * });
 * ```
 */
export function renderWithProviders(
  ui: ReactElement,
  { providerOptions, ...renderOptions }: CustomRenderOptions = {}
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders options={providerOptions}>{children}</AllProviders>
    ),
    ...renderOptions,
  });
}

// ── Breakpoint mock helper ──

import type { Breakpoint } from "../hooks/useBreakpoint";

const BREAKPOINT_QUERIES: Record<string, Breakpoint> = {
  "(max-width: 767px)": "mobile",
  "(min-width: 768px) and (max-width: 1024px)": "tablet",
  "(min-width: 1025px) and (max-width: 1440px)": "desktop",
  "(min-width: 1441px)": "large",
};

/**
 * Mock `window.matchMedia` so that `useBreakpoint()` returns the given breakpoint.
 * Call in `beforeEach` or at the top of a test. Returns the mock for assertions.
 */
export function mockBreakpoint(breakpoint: Breakpoint) {
  const mockMatchMedia = vi.fn().mockImplementation((query: string) => {
    const matchedBp = BREAKPOINT_QUERIES[query];
    return {
      matches: matchedBp === breakpoint,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: mockMatchMedia,
  });

  return mockMatchMedia;
}

/** Re-export everything from @testing-library/react for convenience */
export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";

/** Override render with our custom version */
export { renderWithProviders as render };
