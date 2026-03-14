/**
 * Full-page video player route.
 * Sits outside the AppLayout (no header/sidebar).
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePlayer } from "../hooks/usePlayer";
import { useWatchTogether } from "../hooks/useWatchTogether";
import { useAudioEnhancements } from "../hooks/useAudioEnhancements";
import { usePreferences } from "../hooks/usePreferences";
import { getItemMetadata, getNextEpisode, getPreviousEpisode } from "../services/plex-library";
import PlayerControls from "../components/PlayerControls";
import ParticipantOverlay from "../components/ParticipantOverlay";
import SyncIndicator from "../components/SyncIndicator";
import NextEpisodePrompt from "../components/NextEpisodePrompt";
import type { PlexEpisode, PlexMediaItem } from "../types/library";
import type { NormalizationPreset } from "../types/preferences";

const CONTROLS_HIDE_MS = 3000;
const DOUBLE_CLICK_MS = 250;

function Player() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, serverSelected } = useAuth();
  const navigate = useNavigate();

  // Offset override — ?offset=0 means "play from beginning"
  const offsetParam = searchParams.get("offset");
  const offsetOverride = offsetParam != null ? Number(offsetParam) : null;

  const player = usePlayer(ratingKey ?? "", offsetOverride);

  // Watch Together session from URL query params
  const sessionId = searchParams.get("session");
  const isHost = searchParams.get("host") === "true";
  const relayUrl = searchParams.get("relay");
  const wt = useWatchTogether(player, sessionId, isHost, relayUrl);

  const { server } = useAuth();
  const { preferences, updatePreferences } = usePreferences();
  const pb = preferences.playback;

  // Audio enhancements — Web Audio API processing graph
  const audioEnhancements = useAudioEnhancements(
    player.videoRef,
    pb.volumeBoost,
    pb.normalizationPreset,
    pb.audioOffsetMs,
  );

  const handleAudioEnhancementChange = useCallback(
    (changes: {
      volumeBoost?: number;
      normalizationPreset?: NormalizationPreset;
      audioOffsetMs?: number;
    }) => {
      if (changes.volumeBoost !== undefined) {
        audioEnhancements.setVolumeBoost(changes.volumeBoost);
      }
      if (changes.normalizationPreset !== undefined) {
        audioEnhancements.setNormalizationPreset(changes.normalizationPreset);
      }
      if (changes.audioOffsetMs !== undefined) {
        audioEnhancements.setAudioOffsetMs(changes.audioOffsetMs);
      }
      // Persist to preferences
      updatePreferences({ playback: changes });
    },
    [audioEnhancements, updatePreferences],
  );

  // Sync main volume's above-1.0 boost to the audio graph's GainNode
  useEffect(() => {
    audioEnhancements.setMainBoost(Math.max(player.volume, 1));
  }, [player.volume, audioEnhancements]);

  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Next episode detection (for Watch Together host)
  const [nextEp, setNextEp] = useState<PlexEpisode | null>(null);
  const nextEpFetchedRef = useRef(false);

  useEffect(() => {
    if (!wt.isInSession || !wt.isHost || !server || !ratingKey) return;
    if (nextEpFetchedRef.current) return;

    // Fetch current item to check if it's an episode
    (async () => {
      try {
        const item = await getItemMetadata<PlexMediaItem>(
          server.uri,
          server.accessToken,
          ratingKey
        );
        if (item.type === "episode") {
          const next = await getNextEpisode(
            server.uri,
            server.accessToken,
            item as PlexEpisode
          );
          setNextEp(next);
          nextEpFetchedRef.current = true;
        }
      } catch {
        // Non-critical — just won't show the prompt
      }
    })();
  }, [wt.isInSession, wt.isHost, server, ratingKey]);

  // Episode navigation (prev/next) — works for solo and Watch Together
  const [prevEpNav, setPrevEpNav] = useState<PlexEpisode | null>(null);
  const [nextEpNav, setNextEpNav] = useState<PlexEpisode | null>(null);

  useEffect(() => {
    if (!server || !ratingKey || player.itemType !== "episode") {
      setPrevEpNav(null);
      setNextEpNav(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const item = await getItemMetadata<PlexMediaItem>(
          server.uri,
          server.accessToken,
          ratingKey,
        );
        if (cancelled || item.type !== "episode") return;
        const ep = item as PlexEpisode;
        const [prev, next] = await Promise.all([
          getPreviousEpisode(server.uri, server.accessToken, ep),
          getNextEpisode(server.uri, server.accessToken, ep),
        ]);
        if (cancelled) return;
        setPrevEpNav(prev);
        setNextEpNav(next);
      } catch {
        // Non-critical
      }
    })();
    return () => { cancelled = true; };
  }, [server, ratingKey, player.itemType]);

  const handleNextEpisode = nextEpNav
    ? () => navigate(`/player/${nextEpNav.ratingKey}`)
    : undefined;
  const handlePrevEpisode = prevEpNav
    ? () => navigate(`/player/${prevEpNav.ratingKey}`)
    : undefined;

  useEffect(() => {
    if (player.title) document.title = `${player.title} - Prexu`;
  }, [player.title]);

  // ── Controls visibility ──
  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (player.isPlaying) setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, [player.isPlaying]);

  const handleMouseMove = useCallback(() => {
    resetHideTimer();
  }, [resetHideTimer]);

  // Always show controls when paused
  useEffect(() => {
    if (!player.isPlaying) {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [player.isPlaying]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  // ── Click to pause / double-click fullscreen ──
  const togglePlay = wt.isInSession ? wt.syncTogglePlay : player.togglePlay;
  const seek = wt.isInSession ? wt.syncSeek : player.seek;

  const handleVideoClick = useCallback(() => {
    if (clickTimerRef.current !== null) {
      // Double click detected
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      player.toggleFullscreen();
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        togglePlay();
      }, DOUBLE_CLICK_MS);
    }
    resetHideTimer();
  }, [player, togglePlay, resetHideTimer]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      resetHideTimer();

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            // Chapter skip backward (or 30s fallback)
            if (player.chapters.length > 0) {
              const currentMs = player.currentTime * 1000;
              const sorted = [...player.chapters].sort((a, b) => b.startTimeOffset - a.startTimeOffset);
              const prev = sorted.find((c) => c.startTimeOffset < currentMs - 2000);
              if (prev) { seek(prev.startTimeOffset / 1000); break; }
            }
            seek(Math.max(0, player.currentTime - 30));
          } else {
            seek(Math.max(0, player.currentTime - 10));
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            // Chapter skip forward (or 30s fallback)
            if (player.chapters.length > 0) {
              const currentMs = player.currentTime * 1000;
              const next = player.chapters.find((c) => c.startTimeOffset > currentMs + 1000);
              if (next) { seek(next.startTimeOffset / 1000); break; }
            }
            seek(Math.min(player.duration, player.currentTime + 30));
          } else {
            seek(Math.min(player.duration, player.currentTime + 10));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          player.setVolume(Math.min(1, player.volume + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          player.setVolume(Math.max(0, player.volume - 0.1));
          break;
        case "f":
          player.toggleFullscreen();
          break;
        case "m":
          player.toggleMute();
          break;
        case "Escape":
          if (player.isFullscreen) {
            player.toggleFullscreen();
          } else {
            navigate(-1);
          }
          break;
        // Audio enhancement shortcuts
        case "[":
          handleAudioEnhancementChange({
            volumeBoost: Math.max(1, audioEnhancements.volumeBoost - 0.25),
          });
          break;
        case "]":
          handleAudioEnhancementChange({
            volumeBoost: Math.min(5, audioEnhancements.volumeBoost + 0.25),
          });
          break;
        case "n":
        case "N":
          if (e.shiftKey) {
            if (handleNextEpisode) handleNextEpisode();
          } else {
            const cycle: NormalizationPreset[] = ["off", "light", "night"];
            const idx = cycle.indexOf(audioEnhancements.normalizationPreset);
            const nextPreset = cycle[(idx + 1) % cycle.length];
            handleAudioEnhancementChange({ normalizationPreset: nextPreset });
          }
          break;
        case "p":
        case "P":
          if (e.shiftKey && handlePrevEpisode) handlePrevEpisode();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [player, navigate, resetHideTimer, togglePlay, seek, audioEnhancements, handleAudioEnhancementChange, handleNextEpisode, handlePrevEpisode]);

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  // Auth guards — placed after all hooks to respect React rules of hooks
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!serverSelected) return <Navigate to="/servers" replace />;

  return (
    <div
      style={{
        ...styles.container,
        cursor: controlsVisible ? "default" : "none",
      }}
      onMouseMove={handleMouseMove}
    >
      {/* Video element — receives click-to-pause / double-click-fullscreen */}
      <video
        ref={player.videoRef}
        style={styles.video}
        playsInline
        onClick={handleVideoClick}
      />

      {/* Loading overlay */}
      {player.isLoading && (
        <div style={styles.centerOverlay}>
          <div className="loading-spinner" />
        </div>
      )}

      {/* Buffering overlay (pointer-events: none so clicks pass through to video) */}
      {!player.isLoading && player.isBuffering && (
        <div style={styles.bufferingOverlay}>
          <div className="loading-spinner" />
        </div>
      )}

      {/* Error overlay */}
      {player.playbackError && (
        <div style={styles.errorOverlay}>
          <p style={styles.errorText}>
            {player.playbackError.split("\n")[0]}
          </p>
          {player.playbackError.includes("\n") && (
            <pre style={styles.errorDetails}>
              {player.playbackError.split("\n").slice(1).join("\n")}
            </pre>
          )}
          <div style={styles.errorButtons}>
            <button onClick={player.retry} style={styles.retryButton}>
              Retry
            </button>
            <button onClick={handleBack} style={styles.errorBackButton}>
              Go Back
            </button>
          </div>
        </div>
      )}

      {/* Watch Together overlays */}
      {wt.isInSession && (
        <ParticipantOverlay
          participants={wt.participants}
          visible={controlsVisible}
        />
      )}

      {/* Next episode prompt (host only) */}
      {wt.showNextEpisodePrompt && wt.isHost && nextEp && (
        <NextEpisodePrompt
          nextEpisodeTitle={nextEp.title}
          participantCount={wt.participants.length}
          onContinue={() =>
            wt.loadNextEpisode(nextEp.ratingKey, nextEp.title)
          }
          onEndSession={wt.leaveSession}
        />
      )}

      {/* Player controls overlay — uses pointer-events: none on container,
          pointer-events: auto only on interactive areas (top bar, bottom bar),
          so clicks on the video surface pass through to the <video> above */}
      {!player.isLoading && !player.playbackError && (
        <PlayerControls
          player={player}
          onBack={handleBack}
          visible={controlsVisible}
          chapters={player.chapters}
          onSeek={seek}
          onActivity={resetHideTimer}
          onNextEpisode={handleNextEpisode}
          onPrevEpisode={handlePrevEpisode}
          audioEnhancements={audioEnhancements}
          onAudioEnhancementChange={handleAudioEnhancementChange}
          syncIndicator={
            wt.isInSession ? (
              <SyncIndicator
                syncStatus={wt.syncStatus}
                participantCount={wt.participants.length + 1}
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    inset: 0,
    background: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    outline: "none",
  },
  centerOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.3)",
    zIndex: 5,
  },
  bufferingOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.3)",
    zIndex: 5,
    pointerEvents: "none",
  },
  errorOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    background: "rgba(0,0,0,0.85)",
    zIndex: 20,
  },
  errorText: {
    color: "var(--error)",
    fontSize: "1rem",
    textAlign: "center",
    maxWidth: "400px",
  },
  errorDetails: {
    color: "rgba(255,255,255,0.5)",
    fontSize: "0.7rem",
    fontFamily: "monospace",
    textAlign: "left" as const,
    maxWidth: "500px",
    padding: "0.5rem 0.75rem",
    background: "rgba(255,255,255,0.05)",
    borderRadius: "6px",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    maxHeight: "120px",
    overflow: "auto",
  },
  errorButtons: {
    display: "flex",
    gap: "0.75rem",
  },
  retryButton: {
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.9rem",
    fontWeight: 600,
    padding: "0.5rem 1.25rem",
    borderRadius: "8px",
  },
  errorBackButton: {
    background: "rgba(255,255,255,0.15)",
    color: "var(--text-primary)",
    fontSize: "0.9rem",
    padding: "0.5rem 1.25rem",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.2)",
  },
};

export default Player;
