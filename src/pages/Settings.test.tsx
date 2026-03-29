import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Settings from "./Settings";

const mockUpdatePreferences = vi.fn();

const mockUseAuth = vi.fn();
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
  useHomeUsers: () => ({
    homeUsers: [],
    isPlexHome: false,
    isLoading: false,
    isSwitching: false,
    switchError: null,
    switchTo: vi.fn(),
    clearError: vi.fn(),
  }),
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

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      server: { uri: "https://plex.test", accessToken: "token" },
      activeUser: { isAdmin: true, title: "Admin" },
    });
  });

  it("renders Settings heading", () => {
    render(<Settings />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders Playback section with quality select", () => {
    render(<Settings />);
    expect(screen.getByText("Playback")).toBeInTheDocument();
    expect(screen.getByText("Video Quality")).toBeInTheDocument();
  });

  it("renders Appearance section", () => {
    render(<Settings />);
    expect(screen.getByText("Appearance")).toBeInTheDocument();
  });

  it("renders Watch Together section", () => {
    render(<Settings />);
    expect(screen.getByText("Watch Together")).toBeInTheDocument();
  });

  it("renders About section", () => {
    render(<Settings />);
    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("shows Content Requests section for admin users", () => {
    render(<Settings />);
    expect(screen.getByText("Content Requests")).toBeInTheDocument();
  });

  it("hides TMDb section for non-admin users", () => {
    mockUseAuth.mockReturnValue({
      server: { uri: "https://plex.test", accessToken: "token" },
      activeUser: { isAdmin: false, title: "User" },
    });

    render(<Settings />);
    expect(screen.queryByText("Content Requests")).not.toBeInTheDocument();
  });

  it("shows relay connected status", () => {
    render(<Settings />);
    expect(screen.getByText("Connected to relay")).toBeInTheDocument();
  });

  it("renders audio language select", () => {
    render(<Settings />);
    expect(screen.getByText("Preferred Audio Language")).toBeInTheDocument();
  });

  it("renders subtitle controls", () => {
    render(<Settings />);
    expect(screen.getByText("Default Subtitles")).toBeInTheDocument();
    expect(screen.getByText(/Subtitle Size/)).toBeInTheDocument();
  });

  it("renders poster size radio buttons", () => {
    render(<Settings />);
    expect(screen.getByText("Poster Size")).toBeInTheDocument();
    // "Small" and "Large" also appear in slider labels, so use getAllByText
    expect(screen.getAllByText("Small").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getAllByText("Large").length).toBeGreaterThanOrEqual(1);
  });

  it("calls updatePreferences when changing quality", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const qualitySelect = screen.getByDisplayValue("1080p (20 Mbps)");
    await user.selectOptions(qualitySelect, "720p");

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      playback: { quality: "720p" },
    });
  });

  it("renders skip single season checkbox", () => {
    render(<Settings />);
    expect(
      screen.getByText("Skip seasons page for single-season shows")
    ).toBeInTheDocument();
  });

  it("renders dashboard sections checkboxes", () => {
    render(<Settings />);
    expect(screen.getByText("Dashboard Sections")).toBeInTheDocument();
    // The checkbox labels in the dashboard sections
    expect(screen.getByText("Recently Added Movies")).toBeInTheDocument();
    expect(screen.getByText("Recently Added TV Shows")).toBeInTheDocument();
  });

  it("shows app version in About section", () => {
    render(<Settings />);
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
  });
});
