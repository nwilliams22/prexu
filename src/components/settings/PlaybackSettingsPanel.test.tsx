/**
 * Tests for PlaybackSettingsPanel's new "Player Engine" control
 * (prexu-axj4.4). The control is only rendered when the platform is
 * capable of native playback (Tauri + Windows/Linux) — IS_NATIVE_PLAYER_PLATFORM
 * resolves false under plain jsdom (no __TAURI_INTERNALS__ / matching UA),
 * so the two describe blocks below force it each way via a module mock.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { PlaybackSettingsPanel } from "./PlaybackSettingsPanel";
import type { PlaybackPreferences } from "../../types/preferences";

function makePlayback(overrides: Partial<PlaybackPreferences> = {}): PlaybackPreferences {
  return {
    quality: "1080p",
    preferredAudioLanguage: "",
    preferredSubtitleLanguage: "",
    defaultSubtitles: "auto",
    subtitleSize: 100,
    audioBoost: 100,
    directPlayPreference: "auto",
    volumeBoost: 1,
    normalizationPreset: "off",
    audioOffsetMs: 0,
    skipIntroEnabled: true,
    skipCreditsEnabled: true,
    autoPlayEnabled: true,
    playerEngine: "auto",
    subtitleStyle: {
      fontFamily: "sans-serif",
      textColor: "#FFFFFF",
      backgroundColor: "#000000",
      backgroundOpacity: 0.75,
      outlineColor: "#000000",
      outlineWidth: 2,
      shadowEnabled: true,
    },
    ...overrides,
  };
}

describe("PlaybackSettingsPanel — platform incapable of native (plain jsdom default)", () => {
  it("does not render the Player Engine control", () => {
    render(
      <PlaybackSettingsPanel playback={makePlayback()} updatePlayback={vi.fn()} />,
    );
    expect(screen.queryByText("Player Engine")).not.toBeInTheDocument();
  });
});

describe("PlaybackSettingsPanel — platform capable of native (Tauri + Windows/Linux)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../../hooks/player/engineResolution", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../hooks/player/engineResolution")>()),
      IS_NATIVE_PLAYER_PLATFORM: true,
    }));
  });

  it("renders the Player Engine select with the current value and a hint", async () => {
    const { PlaybackSettingsPanel: PanelWithNative } = await import(
      "./PlaybackSettingsPanel"
    );
    render(
      <PanelWithNative playback={makePlayback({ playerEngine: "native" })} updatePlayback={vi.fn()} />,
    );

    expect(screen.getByText("Player Engine")).toBeInTheDocument();
    expect(screen.getByText(/applies the next time you open the player/i)).toBeInTheDocument();
    const select = screen.getByDisplayValue("Native (mpv)") as HTMLSelectElement;
    expect(select.value).toBe("native");
  });

  it("calls updatePlayback with the new engine value on change", async () => {
    const { PlaybackSettingsPanel: PanelWithNative } = await import(
      "./PlaybackSettingsPanel"
    );
    const updatePlayback = vi.fn();
    render(
      <PanelWithNative playback={makePlayback({ playerEngine: "auto" })} updatePlayback={updatePlayback} />,
    );

    const select = screen.getByDisplayValue("Auto — native when available");
    fireEvent.change(select, { target: { value: "html5" } });

    expect(updatePlayback).toHaveBeenCalledWith({ playerEngine: "html5" });
  });
});
