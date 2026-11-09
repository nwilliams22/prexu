import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Settings from "./Settings";

const mockUpdatePreferences = vi.fn();

const mockUseAuth = vi.fn();
const mockHomeUsers = vi.fn(() => ({ homeUsers: [] as { id: number; title: string; admin: boolean; thumb: string; protected: boolean }[], isPlexHome: false }));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../hooks/useInvites", () => ({
  useInvites: () => ({ isRelayConnected: true, refreshInvites: vi.fn() }),
}));

vi.mock("../hooks/usePreferences", () => ({
  usePreferences: () => ({
    preferences: {
      playback: {
        quality: "1080p",
        preferredAudioLanguage: "eng",
        preferredSubtitleLanguage: "",
        defaultSubtitles: "auto",
        subtitleSize: 100,
        audioBoost: 100,
        directPlayPreference: "auto",
        volumeBoost: 1.0,
        normalizationPreset: "off",
        audioOffsetMs: 0,
        skipIntroEnabled: true,
        skipCreditsEnabled: true,
        autoPlayEnabled: true,
        subtitleStyle: {
          fontFamily: "sans-serif",
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          backgroundOpacity: 0.75,
          outlineColor: "#000000",
          outlineWidth: 2,
          shadowEnabled: true,
        },
      },
      appearance: {
        posterSize: "medium",
        sidebarCollapsed: false,
        skipSingleSeason: true,
        dashboardSections: {
          continueWatching: true,
          recentMovies: true,
          recentShows: true,
        },
      },
    },
    updatePreferences: mockUpdatePreferences,
    loadState: "ready",
    saveStates: {},
  }),
}));

vi.mock("../services/storage", () => ({
  getRelayUrl: vi.fn(() => Promise.resolve("")),
  saveRelayUrl: vi.fn(() => Promise.resolve()),
  clearRelayUrl: vi.fn(() => Promise.resolve()),
  hasManualRelayUrl: vi.fn(() => Promise.resolve(false)),
  deriveRelayUrl: vi.fn(() => "ws://localhost:9847/ws"),
  getInviteVolume: vi.fn(() => Promise.resolve(0.5)),
  saveInviteVolume: vi.fn(() => Promise.resolve()),
  getInviteSoundConfig: vi.fn(() => Promise.resolve({ sound: "chime" })),
  saveInviteSoundConfig: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(() => Promise.resolve()),
}));

vi.mock("../utils/notificationSound", () => ({
  previewSound: vi.fn(),
  previewCustomDataUrl: vi.fn(),
}));

vi.mock("../hooks/useHomeUsers", () => ({
  useHomeUsers: () => mockHomeUsers(),
}));

vi.mock("../hooks/useParentalControls", () => ({
  useParentalControls: () => ({
    restrictionsEnabled: false,
    filterByRating: (items: unknown[]) => items,
    isItemAllowed: () => true,
    maxContentRating: "none",
    loadForUser: vi.fn(() => Promise.resolve({ enabled: false, maxContentRating: "none" })),
    saveForUser: vi.fn(() => Promise.resolve()),
  }),
}));

vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn(), dismissAll: vi.fn() }),
}));

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname}</output><button onClick={() => navigate(-1)}>Back</button></>;
}
function renderSettings(path = "/settings/playback") {
  return render(<MemoryRouter initialEntries={[path]}><LocationProbe /><Routes><Route path="/settings/*" element={<Settings />} /></Routes></MemoryRouter>);
}

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHomeUsers.mockReturnValue({ homeUsers: [], isPlexHome: false });
    mockUseAuth.mockReturnValue({ server: { uri: "https://plex.test" }, activeUser: { isAdmin: true, title: "Admin" } });
  });

  it.each(["/settings", "/settings/unknown", "/settings/audio/unknown"])("redirects %s to Playback", async (path) => {
    renderSettings(path);
    expect(await screen.findByRole("heading", { name: "Playback", level: 2 })).toHaveFocus();
    expect(screen.getByTestId("location")).toHaveTextContent("/settings/playback");
  });

  it("pushes category navigation and restores it with Back", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("link", { name: "Audio" }));
    expect(screen.getByRole("heading", { name: "Audio", level: 2 })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Audio" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Preferred Audio Language")).toBeVisible();
    expect(screen.getByText("Video Quality")).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Playback", level: 2 })).toHaveFocus();
  });

  it("supports the category select", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.selectOptions(screen.getByLabelText("Settings category"), "subtitles");
    expect(screen.getByText("Default Subtitles")).toBeVisible();
    expect(screen.getByText("Sample Subtitle Text")).toBeVisible();
  });

  it("preserves unfinished relay input across category changes", async () => {
    const user = userEvent.setup();
    renderSettings("/settings/connections");
    await user.click(await screen.findByRole("button", { name: "Use custom relay URL" }));
    const input = screen.getByPlaceholderText("ws://your-server:9847/ws");
    await user.type(input, "ws://draft.test/ws");
    await user.click(screen.getByRole("link", { name: "About" }));
    expect(screen.getByText("Content Requests")).toBeVisible();
    expect(input).not.toBeVisible();
    await user.click(screen.getByRole("link", { name: "Connections & notifications" }));
    expect(input).toHaveValue("ws://draft.test/ws");
    expect(input).toBeVisible();
  });

  it("preserves an unfinished parental-control edit across categories", async () => {
    mockHomeUsers.mockReturnValue({ isPlexHome: true, homeUsers: [{ id: 2, title: "Child", admin: false, thumb: "", protected: false }] });
    const user = userEvent.setup();
    renderSettings("/settings/parental-controls");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("checkbox", { name: "Enable content restrictions" }));
    await user.selectOptions(screen.getByDisplayValue("No Restriction"), "PG");
    await user.click(screen.getByRole("link", { name: "Playback" }));
    await user.click(screen.getByRole("link", { name: "Parental controls" }));
    expect(screen.getByRole("checkbox", { name: "Enable content restrictions" })).toBeChecked();
    expect(screen.getByDisplayValue("PG — Parental Guidance")).toBeVisible();
  });

  it("hides admin navigation and redirects unauthorized categories", async () => {
    mockUseAuth.mockReturnValue({ activeUser: { isAdmin: false } });
    renderSettings("/settings/parental-controls");
    expect(await screen.findByRole("heading", { name: "Playback", level: 2 })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Parental controls" })).not.toBeInTheDocument();
    expect(screen.queryByText("Content Requests")).not.toBeInTheDocument();
  });

  it("preserves preference update payloads", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.selectOptions(screen.getByDisplayValue("1080p (20 Mbps)"), "720p");
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ playback: { quality: "720p" } });
    await user.click(screen.getByRole("link", { name: "Appearance" }));
    await user.click(screen.getByRole("radio", { name: "Large" }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ appearance: { posterSize: "large" } });
  });
});
