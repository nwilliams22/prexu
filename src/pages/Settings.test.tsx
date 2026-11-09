import { createMemoryRouter, RouterProvider, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Settings from "./Settings";

const mockUpdatePreferences = vi.fn();
const mockLoadRestrictions = vi.fn(() => Promise.resolve({ enabled: false, maxContentRating: "none" }));

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
    loadForUser: mockLoadRestrictions,
    saveForUser: vi.fn(() => Promise.resolve()),
  }),
}));

vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn(), dismissAll: vi.fn() }),
}));

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname}{location.search}{location.hash}</output><button onClick={() => navigate(-1)}>Back</button></>;
}
function renderSettings(path = "/settings/playback") {
  return render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <><LocationProbe /><Routes><Route path="/settings/*" element={<Settings />} /></Routes></> }], { initialEntries: [path] })} />);
}

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
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
    expect(screen.getByText("Sample subtitle text")).toBeVisible();
  });

  it("guards dirty relay category navigation, default focus and Escape keep editing", async () => {
    const user = userEvent.setup();
    renderSettings("/settings/connections");
    await user.click(await screen.findByRole("button", { name: "Use custom relay URL" }));
    const input = screen.getByRole("textbox", { name: "Custom relay URL" });
    await user.type(input, "ws://draft.test/ws");
    await user.click(screen.getByRole("link", { name: "About" }));
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(input).toHaveValue("ws://draft.test/ws");
    expect(screen.getByTestId("location")).toHaveTextContent("/settings/connections");
    await user.click(screen.getByRole("link", { name: "About" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("heading", { name: "About", level: 2 })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: "Use custom relay URL" })).toBeVisible();
  });

  it("guards switching users and category with dirty restrictions", async () => {
    mockHomeUsers.mockReturnValue({ isPlexHome: true, homeUsers: [{ id: 2, title: "Child", admin: false, thumb: "", protected: false }, { id: 3, title: "Teen", admin: false, thumb: "", protected: false }] });
    const user = userEvent.setup();
    renderSettings("/settings/parental-controls");
    await user.click(await screen.findByRole("button", { name: "Edit Child" }));
    await user.click(screen.getByRole("checkbox", { name: "Enable content restrictions" }));
    await user.selectOptions(screen.getByDisplayValue("No Restriction"), "PG");
    await user.click(screen.getByRole("button", { name: "Edit Teen" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByDisplayValue("PG — Parental Guidance")).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Playback" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await user.click(screen.getByRole("link", { name: "Parental controls" }));
    await user.click(await screen.findByRole("button", { name: "Edit Child" }));
    expect(screen.getByRole("checkbox", { name: "Enable content restrictions" })).not.toBeChecked();
  });

  it("hides admin navigation and explains unauthorized direct access without loading users", async () => {
    mockUseAuth.mockReturnValue({ activeUser: { isAdmin: false } });
    renderSettings("/settings/parental-controls");
    expect(await screen.findByText("Parental controls are available to administrators")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Parental controls" })).not.toBeInTheDocument();
    expect(mockHomeUsers).not.toHaveBeenCalled();
    expect(mockLoadRestrictions).not.toHaveBeenCalled();
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


describe("Settings search navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHomeUsers.mockReturnValue({ homeUsers: [], isPlexHome: false });
    mockUseAuth.mockReturnValue({ server: { uri: "https://private-server.test" }, activeUser: { isAdmin: true, title: "Private Name" } });
  });
  it("replaces typing history, pushes results, focuses the control and restores results on Back", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.type(screen.getByRole("searchbox"), "audio language");
    expect(screen.getByTestId("location")).toHaveTextContent("?q=audio+language");
    expect(screen.queryByRole("combobox", { name: "Video Quality" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Preferred Audio Language.*Language/ }));
    expect(screen.getByLabelText("Preferred Audio Language")).toHaveFocus();
    expect(screen.getByTestId("location")).toHaveTextContent("/settings/audio#setting-P7");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("searchbox")).toHaveValue("audio language");
    expect(screen.getByRole("link", { name: /Preferred Audio Language.*Language/ })).toBeVisible();
    expect(mockUpdatePreferences).not.toHaveBeenCalled();
  });
  it("supports no results and Escape without losing search focus or changing preferences", async () => {
    const user = userEvent.setup();
    renderSettings("/settings/audio?q=Private%20Name");
    expect(screen.getByText("No settings match ‘Private Name’")).toBeVisible();
    await user.click(screen.getByRole("searchbox"));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByLabelText("Preferred Audio Language")).toBeVisible();
    expect(mockUpdatePreferences).not.toHaveBeenCalled();
  });
  it("focuses a selected radio, read-only entry and parental section without opening an editor", async () => {
    const user = userEvent.setup();
    renderSettings("/settings/playback?q=poster");
    await user.click(screen.getByRole("link", { name: /Poster Size.*Interface/ }));
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveFocus();
    await user.type(screen.getByRole("searchbox"), "version");
    await user.click(screen.getByRole("link", { name: /App version/ }));
    expect(document.getElementById("about-version")).toHaveFocus();
    await user.type(screen.getByRole("searchbox"), "rating");
    await user.click(screen.getByRole("link", { name: /Maximum Allowed Rating/ }));
    expect(screen.getByRole("heading", { name: "Managed users" })).toHaveFocus();
    expect(screen.queryByRole("checkbox", { name: "Enable content restrictions" })).not.toBeInTheDocument();
  });
});


it("search targets the existing relay editor without discarding an unchanged draft", async () => {
  mockUseAuth.mockReturnValue({ activeUser: { isAdmin: true } });
  const user = userEvent.setup();
  renderSettings("/settings/connections");
  await user.click(await screen.findByRole("button", { name: "Use custom relay URL" }));
  await user.type(screen.getByRole("searchbox"), "custom relay url");
  await user.click(screen.getByRole("link", { name: /Custom relay URL.*Relay connection/ }));
  expect(screen.getByRole("textbox", { name: "Custom relay URL" })).toHaveFocus();
});
