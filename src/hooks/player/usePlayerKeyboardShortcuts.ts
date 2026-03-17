/**
 * Keyboard shortcut handling for the video player.
 */

import { useEffect } from "react";
import type { NormalizationPreset } from "../../types/preferences";

export interface KeyboardShortcutDeps {
  /** Toggle play/pause (sync-aware) */
  togglePlay: () => void;
  /** Seek to time (sync-aware) */
  seek: (time: number) => void;
  /** Current playback time in seconds */
  currentTime: number;
  /** Total duration in seconds */
  duration: number;
  /** Current volume 0-1 */
  volume: number;
  /** Set volume */
  setVolume: (v: number) => void;
  /** Toggle fullscreen */
  toggleFullscreen: () => void;
  /** Toggle mute */
  toggleMute: () => void;
  /** Whether currently fullscreen */
  isFullscreen: boolean;
  /** Navigate back */
  onBack: () => void;
  /** Reset controls hide timer */
  resetHideTimer: () => void;
  /** Chapter markers */
  chapters: Array<{ startTimeOffset: number }>;
  /** Audio enhancement values */
  volumeBoost: number;
  normalizationPreset: NormalizationPreset;
  /** Audio enhancement change handler */
  onAudioEnhancementChange: (changes: {
    volumeBoost?: number;
    normalizationPreset?: NormalizationPreset;
  }) => void;
  /** Episode navigation */
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
}

export function usePlayerKeyboardShortcuts(deps: KeyboardShortcutDeps): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      deps.resetHideTimer();

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          deps.togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            // Chapter skip backward (or 30s fallback)
            if (deps.chapters.length > 0) {
              const currentMs = deps.currentTime * 1000;
              const sorted = [...deps.chapters].sort((a, b) => b.startTimeOffset - a.startTimeOffset);
              const prev = sorted.find((c) => c.startTimeOffset < currentMs - 2000);
              if (prev) { deps.seek(prev.startTimeOffset / 1000); break; }
            }
            deps.seek(Math.max(0, deps.currentTime - 30));
          } else {
            deps.seek(Math.max(0, deps.currentTime - 10));
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            // Chapter skip forward (or 30s fallback)
            if (deps.chapters.length > 0) {
              const currentMs = deps.currentTime * 1000;
              const next = deps.chapters.find((c) => c.startTimeOffset > currentMs + 1000);
              if (next) { deps.seek(next.startTimeOffset / 1000); break; }
            }
            deps.seek(Math.min(deps.duration, deps.currentTime + 30));
          } else {
            deps.seek(Math.min(deps.duration, deps.currentTime + 10));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          deps.setVolume(Math.min(1, deps.volume + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          deps.setVolume(Math.max(0, deps.volume - 0.1));
          break;
        case "f":
          deps.toggleFullscreen();
          break;
        case "m":
          deps.toggleMute();
          break;
        case "Escape":
          if (deps.isFullscreen) {
            deps.toggleFullscreen();
          } else {
            deps.onBack();
          }
          break;
        // Audio enhancement shortcuts
        case "[":
          deps.onAudioEnhancementChange({
            volumeBoost: Math.max(1, deps.volumeBoost - 0.25),
          });
          break;
        case "]":
          deps.onAudioEnhancementChange({
            volumeBoost: Math.min(5, deps.volumeBoost + 0.25),
          });
          break;
        case "n":
        case "N":
          if (e.shiftKey) {
            if (deps.onNextEpisode) deps.onNextEpisode();
          } else {
            const cycle: NormalizationPreset[] = ["off", "light", "night"];
            const idx = cycle.indexOf(deps.normalizationPreset);
            const nextPreset = cycle[(idx + 1) % cycle.length];
            deps.onAudioEnhancementChange({ normalizationPreset: nextPreset });
          }
          break;
        case "p":
        case "P":
          if (e.shiftKey && deps.onPrevEpisode) deps.onPrevEpisode();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deps]);
}
