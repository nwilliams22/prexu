import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { usePlayerKeyboardShortcuts, type KeyboardShortcutDeps } from "./usePlayerKeyboardShortcuts";

it("releases library navigation keys while PiP is active and restores shortcuts on exit", () => {
  const deps: KeyboardShortcutDeps = {
    enabled: true,
    togglePlay: vi.fn(), seek: vi.fn(), currentTime: 60, duration: 120,
    volume: 1, setVolume: vi.fn(), toggleFullscreen: vi.fn(), toggleMute: vi.fn(),
    isFullscreen: false, onBack: vi.fn(), resetHideTimer: vi.fn(), chapters: [],
    volumeBoost: 1, normalizationPreset: "none", onAudioEnhancementChange: vi.fn(),
  };
  const { rerender } = renderHook(({ enabled }) => usePlayerKeyboardShortcuts({ ...deps, enabled }), {
    initialProps: { enabled: true },
  });
  rerender({ enabled: false });
  for (const key of [" ", "ArrowLeft", "Escape"]) {
    const event = new KeyboardEvent("keydown", { key, cancelable: true });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  }
  expect(deps.togglePlay).not.toHaveBeenCalled();
  expect(deps.seek).not.toHaveBeenCalled();
  expect(deps.onBack).not.toHaveBeenCalled();
  rerender({ enabled: true });
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" })));
  expect(deps.seek).toHaveBeenCalledWith(50);
});
