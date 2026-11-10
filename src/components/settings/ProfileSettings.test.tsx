import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { usePreferencesState } from "../../hooks/usePreferences";
import { getDefaultPreferences } from "../../services/storage/preferences";
import { PreferenceSaveContext } from "./PreferenceSaveStatus";
import { PlaybackSettingsPanel } from "./PlaybackSettingsPanel";
import { AudioSettingsPanel } from "./AudioSettingsPanel";
import { AppearanceSettingsPanel } from "./AppearanceSettingsPanel";
import { SubtitlesSettingsPanel } from "./SubtitlesSettingsPanel";
import { SubtitleStylePanel } from "./SubtitleStylePanel";
import { __resetEngineFallbackForTests, setSessionFallbackActive } from "../../hooks/player/engineResolution";

vi.mock("../../hooks/player/engineResolution", async (original) => ({
  ...await original<typeof import("../../hooks/player/engineResolution")>(), IS_NATIVE_PLAYER_PLATFORM: true,
}));

function Panels({ userId = 1 }: { userId?: number }) {
  const state = usePreferencesState(userId);
  const { preferences: { playback, appearance }, updatePreferences } = state;
  return <PreferenceSaveContext value={state}>
    <fieldset disabled={state.loadState !== "ready"}>
      <PlaybackSettingsPanel playback={playback} updatePlayback={(partial) => updatePreferences({ playback: partial })} />
      <AudioSettingsPanel playback={playback} updatePlayback={(partial) => updatePreferences({ playback: partial })} />
      <SubtitlesSettingsPanel playback={playback} updatePlayback={(partial) => updatePreferences({ playback: partial })} updateSubtitleStyle={(partial) => updatePreferences({ playback: { subtitleStyle: partial } })} />
      <AppearanceSettingsPanel appearance={appearance} updateAppearance={(partial) => updatePreferences({ appearance: partial })} updatePreferences={updatePreferences} />
    </fieldset>
  </PreferenceSaveContext>;
}

beforeEach(() => { localStorage.clear(); __resetEngineFallbackForTests(); });

it("hydrates all 29 inventory values from populated legacy storage and preserves unrelated nested values on every update", async () => {
  const saved = getDefaultPreferences();
  saved.playback = { ...saved.playback, playerEngine: "native", quality: "480p", directPlayPreference: "never", skipIntroEnabled: false, skipCreditsEnabled: false, autoPlayEnabled: false, preferredAudioLanguage: "jpn", defaultSubtitles: "always", preferredSubtitleLanguage: "fra", subtitleSize: 180, audioBoost: 160, volumeBoost: 3.25, normalizationPreset: "night", audioOffsetMs: 350, subtitleStyle: { fontFamily: "'Georgia', serif", textColor: "#123456", backgroundColor: "#abcdef", backgroundOpacity: 0.25, outlineColor: "#654321", outlineWidth: 4, shadowEnabled: false } };
  saved.appearance = { theme: "light", posterSize: "large", sidebarCollapsed: true, dashboardSections: { continueWatching: false, recentMovies: false, recentShows: false }, skipSingleSeason: false, minCollectionSize: 9 };
  localStorage.setItem("prexu_preferences", JSON.stringify(saved));
  const { container } = render(<Panels />);
  await waitFor(() => expect(screen.getByLabelText("Video Quality")).toBeEnabled());
  expect(localStorage.getItem("prexu_preferences_1")).toBeNull();
  const edits = [
    ["P1", "playback.playerEngine", "native", "html5"], ["P2", "playback.quality", "480p", "720p"], ["P3", "playback.directPlayPreference", "never", "always"],
    ["P4", "playback.skipIntroEnabled", false, true], ["P5", "playback.skipCreditsEnabled", false, true], ["P6", "playback.autoPlayEnabled", false, true],
    ["P7", "playback.preferredAudioLanguage", "jpn", "spa"], ["L1", "playback.defaultSubtitles", "always", "auto"], ["L2", "playback.preferredSubtitleLanguage", "fra", "eng"], ["L3", "playback.subtitleSize", 180, 120],
    ["S1", "playback.subtitleStyle.fontFamily", "'Georgia', serif", "'Courier New', monospace"], ["S2", "playback.subtitleStyle.textColor", "#123456", "#ffffff"], ["S3", "playback.subtitleStyle.backgroundColor", "#abcdef", "#000000"], ["S4", "playback.subtitleStyle.backgroundOpacity", 0.25, 0], ["S5", "playback.subtitleStyle.outlineColor", "#654321", "#ffffff"], ["S6", "playback.subtitleStyle.outlineWidth", 4, 0], ["S7", "playback.subtitleStyle.shadowEnabled", false, true],
    ["A1", "playback.audioBoost", 160, 200], ["A2", "playback.volumeBoost", 325, 500], ["A3", "playback.normalizationPreset", "night", "light"], ["A4", "playback.audioOffsetMs", 350, 500],
    ["V1", "appearance.theme", "light", "dark"], ["V2", "appearance.posterSize", "large", "small"], ["V3", "appearance.sidebarCollapsed", true, false], ["V4", "appearance.dashboardSections.continueWatching", false, true], ["V5", "appearance.dashboardSections.recentMovies", false, true], ["V6", "appearance.dashboardSections.recentShows", false, true], ["V7", "appearance.skipSingleSeason", false, true], ["V8", "appearance.minCollectionSize", 9, 2],
  ] as const;
  const expected = structuredClone(saved);
  for (const [id, path, old, next] of edits) {
    const control = container.querySelector<HTMLElement>(`#${id}`)!;
    if (control.tagName === "FIELDSET") {
      expect(control.querySelector<HTMLInputElement>("input:checked")?.value).toBe(String(old));
      fireEvent.click(control.querySelector(`input[value="${next}"]`)!);
    } else if (typeof old === "boolean") {
      expect(control).not.toBeChecked();
      fireEvent.click(control);
    } else {
      expect((control as HTMLInputElement).value).toBe(String(old));
      fireEvent.change(control, { target: { value: String(next) } });
    }
    const parts = path.split(".");
    let node = expected as unknown as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) node = node[part] as Record<string, unknown>;
    node[parts.at(-1)!] = id === "A2" ? Number(next) / 100 : next;
    await waitFor(() => expect(JSON.parse(localStorage.getItem("prexu_preferences_1")!)).toEqual(expected));
  }
  expect(JSON.parse(localStorage.getItem("prexu_preferences")!)).toEqual(saved);
  expect((await axe(container)).violations).toEqual([]);
// This integration test performs 29 sequential persisted edits plus an axe audit.
}, 15_000);

it("keeps disabled subtitle language and colors, previews size, and loads each profile without copying values", async () => {
  const first = getDefaultPreferences();
  first.playback.preferredSubtitleLanguage = "fra";
  first.playback.defaultSubtitles = "off";
  first.playback.subtitleStyle.backgroundOpacity = 0;
  first.playback.subtitleStyle.outlineWidth = 0;
  localStorage.setItem("prexu_preferences_1", JSON.stringify(first));
  // A partial old style must pick up defaults without losing its saved color.
  localStorage.setItem("prexu_preferences_2", JSON.stringify({ playback: { subtitleSize: 200, subtitleStyle: { textColor: "#123456" } }, appearance: { dashboardSections: { recentShows: false } } }));
  const { rerender } = render(<Panels />);
  const language = screen.getByLabelText("Preferred Subtitle Language");
  await waitFor(() => expect(language).toHaveValue("fra"));
  expect(language).toBeDisabled();
  expect(screen.getByLabelText("Background Color")).toBeEnabled();
  expect(screen.getByLabelText("Outline Color")).toBeEnabled();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Default Subtitles"), "always");
  expect(language).toHaveValue("fra");
  await waitFor(() => expect(JSON.parse(localStorage.getItem("prexu_preferences_1")!).playback.defaultSubtitles).toBe("always"));
  rerender(<Panels userId={2} />);
  await waitFor(() => expect(screen.getByLabelText("Text Color")).toHaveValue("#123456"));
  expect(screen.getByText("Sample subtitle text")).toHaveStyle({ fontSize: "2.2rem" });
  expect(screen.getByLabelText("Background Opacity")).toHaveValue("0.75");
  expect(screen.getByLabelText("Recently Added TV Shows")).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("Outline Width"), { target: { value: "3" } });
  await waitFor(() => expect(JSON.parse(localStorage.getItem("prexu_preferences_2")!).playback.subtitleStyle.outlineWidth).toBe(3));
  rerender(<Panels userId={1} />);
  await waitFor(() => expect(screen.getByLabelText("Preferred Subtitle Language")).toHaveValue("fra"));
  expect(screen.getByLabelText("Outline Width")).toHaveValue("0");
});

it("reacts to runtime fallback without changing the stored native choice or disabling quality", async () => {
  const prefs = getDefaultPreferences(); prefs.playback.playerEngine = "native";
  localStorage.setItem("prexu_preferences_1", JSON.stringify(prefs));
  render(<Panels />);
  await waitFor(() => expect(screen.getByLabelText("Player Engine")).toHaveValue("native"));
  act(() => setSessionFallbackActive(true));
  expect(screen.getByText(/HTML5 is in use after a player error/)).toBeVisible();
  expect(screen.getByLabelText("Player Engine")).toHaveValue("native");
  expect(screen.getByLabelText("Video Quality")).toBeEnabled();
  expect(JSON.parse(localStorage.getItem("prexu_preferences_1")!)).toEqual(prefs);
});

it("preserves the frameless player popup with its existing style-only update contract", () => {
  const update = vi.fn();
  const { container } = render(<SubtitleStylePanel frameless subtitleStyle={getDefaultPreferences().playback.subtitleStyle} updateSubtitleStyle={update} />);
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  expect(container.querySelector(".settings-section")).toBeNull();
  fireEvent.change(screen.getByLabelText("Subtitle text color"), { target: { value: "#123456" } });
  expect(update).toHaveBeenCalledWith({ textColor: "#123456" });
  expect(screen.getByText("Sample Subtitle Text")).toBeVisible();
});
