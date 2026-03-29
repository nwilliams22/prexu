/**
 * Full-page video player route.
 * Sits outside the AppLayout (no header/sidebar).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getImageUrl } from "../services/plex-library";
import { usePlayer } from "../hooks/usePlayer";
import { useWatchTogether } from "../hooks/useWatchTogether";
import { useAudioEnhancements } from "../hooks/useAudioEnhancements";
import { usePreferences } from "../hooks/usePreferences";
import { useSkipSegments } from "../hooks/player/useSkipSegments";
import { usePlayerControlsVisibility } from "../hooks/player/usePlayerControlsVisibility";
import { useVideoClickHandling } from "../hooks/player/useVideoClickHandling";
import { useEpisodeNavigation } from "../hooks/player/useEpisodeNavigation";
import { useQueueAutoPopulate } from "../hooks/player/useQueueAutoPopulate";
import { useQueue } from "../contexts/QueueContext";
import { useNextEpisodeDetection } from "../hooks/player/useNextEpisodeDetection";
import { usePlayerKeyboardShortcuts } from "../hooks/player/usePlayerKeyboardShortcuts";
import { usePictureInPicture } from "../hooks/player/usePictureInPicture";
import PlayerControls from "../components/PlayerControls";
import ParticipantOverlay from "../components/ParticipantOverlay";
import SyncIndicator from "../components/SyncIndicator";
import NextEpisodePrompt from "../components/NextEpisodePrompt";
import ErrorOverlay from "../components/player/ErrorOverlay";
import SkipSegmentButton from "../components/player/SkipSegmentButton";
import QueuePanel from "../components/player/QueuePanel";
import PostPlayScreen from "../components/player/PostPlayScreen";
import KeyboardShortcutsOverlay from "../components/player/KeyboardShortcutsOverlay";
import type { NormalizationPreset } from "../types/preferences";
import { buildSubtitleCss } from "../utils/subtitle-css";

function Player() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, serverSelected, server } = useAuth();
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

  const { preferences, updatePreferences } = usePreferences();
  const pb = preferences.playback;

  // Subtitle styling via ::cue CSS
  const subtitleCss = useMemo(() => buildSubtitleCss(pb.subtitleStyle), [pb.subtitleStyle]);
  useEffect(() => {
    const id = "prexu-subtitle-style";
    let styleEl = document.getElementById(id) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = id;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = subtitleCss;
    return () => {
      styleEl?.remove();
    };
  }, [subtitleCss]);

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
      updatePreferences({ playback: changes });
    },
    [audioEnhancements, updatePreferences],
  );

  // Sync main volume's above-1.0 boost to the audio graph's GainNode
  useEffect(() => {
    audioEnhancements.setMainBoost(Math.max(player.volume, 1));
  }, [player.volume, audioEnhancements]);

  // Picture-in-Picture
  const pip = usePictureInPicture(player.videoRef);

  // Controls visibility (auto-hide on inactivity)
  const { controlsVisible, resetHideTimer, handleMouseMove } =
    usePlayerControlsVisibility(player.isPlaying);

  // Sync-aware play/seek
  const togglePlay = wt.isInSession ? wt.syncTogglePlay : player.togglePlay;
  const seek = wt.isInSession ? wt.syncSeek : player.seek;

  // Click-to-pause / double-click-fullscreen
  const handleVideoClick = useVideoClickHandling(
    togglePlay,
    player.toggleFullscreen,
    resetHideTimer,
  );

  // Playback queue
  const { queue, remainingCount, playNext, playPrev } = useQueue();
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const toggleQueuePanel = useCallback(() => setQueuePanelOpen((v) => !v), []);

  // Auto-populate queue for episodes
  useQueueAutoPopulate(server?.uri, server?.accessToken, ratingKey, player.itemType);

  // Episode navigation — uses queue when available, falls back to Plex API
  const episodeNav = useEpisodeNavigation(
    server,
    ratingKey,
    player.itemType,
  );

  const handleNextEpisode = useCallback(() => {
    const next = playNext();
    if (next) {
      navigate(`/play/${next.ratingKey}`);
    } else if (episodeNav.handleNextEpisode) {
      episodeNav.handleNextEpisode();
    }
  }, [playNext, episodeNav.handleNextEpisode, navigate]);

  const handlePrevEpisode = useCallback(() => {
    const prev = playPrev();
    if (prev) {
      navigate(`/play/${prev.ratingKey}`);
    } else if (episodeNav.handlePrevEpisode) {
      episodeNav.handlePrevEpisode();
    }
  }, [playPrev, episodeNav.handlePrevEpisode, navigate]);

  // Post-play screen — show when playback ends and queue has next item
  const [showPostPlay, setShowPostPlay] = useState(false);
  const postPlayShownRef = useRef(false);

  useEffect(() => {
    const video = player.videoRef.current;
    if (!video) return;
    const handleEnded = () => {
      if (remainingCount > 0 && !wt.isInSession && !postPlayShownRef.current) {
        postPlayShownRef.current = true;
        setShowPostPlay(true);
      }
    };
    video.addEventListener("ended", handleEnded);
    return () => video.removeEventListener("ended", handleEnded);
  }, [player.videoRef, remainingCount, wt.isInSession]);

  // Reset post-play state when ratingKey changes
  useEffect(() => {
    postPlayShownRef.current = false;
    setShowPostPlay(false);
  }, [ratingKey]);

  const handlePostPlayNext = useCallback(() => {
    setShowPostPlay(false);
    handleNextEpisode();
  }, [handleNextEpisode]);

  const handlePostPlayStop = useCallback(() => {
    setShowPostPlay(false);
  }, []);

  // Get the next queue item for the post-play screen
  const nextQueueItem = useMemo(() => {
    const { items, currentIndex } = queue;
    const nextIdx = currentIndex + 1;
    return nextIdx < items.length ? items[nextIdx] : null;
  }, [queue]);

  // Skip intro/credits segments
  const { activeSegment, dismissSegment } = useSkipSegments(
    player.markers,
    player.chapters,
    player.currentTime,
    { intro: pb.skipIntroEnabled, credits: pb.skipCreditsEnabled },
  );

  const handleSkipSegment = useCallback(() => {
    if (activeSegment) {
      seek(activeSegment.endTime);
    }
  }, [activeSegment, seek]);

  // Next episode detection for Watch Together host
  const nextEp = useNextEpisodeDetection(
    wt.isInSession,
    wt.isHost,
    server,
    ratingKey,
  );

  // Keyboard shortcuts overlay
  const [showShortcuts, setShowShortcuts] = useState(false);
  const toggleShortcuts = useCallback(() => setShowShortcuts((v) => !v), []);

  // Keyboard shortcuts
  const handleBack = useCallback(() => navigate(-1), [navigate]);

  usePlayerKeyboardShortcuts({
    togglePlay,
    seek,
    currentTime: player.currentTime,
    duration: player.duration,
    volume: player.volume,
    setVolume: player.setVolume,
    toggleFullscreen: player.toggleFullscreen,
    toggleMute: player.toggleMute,
    isFullscreen: player.isFullscreen,
    onBack: handleBack,
    resetHideTimer,
    chapters: player.chapters,
    volumeBoost: audioEnhancements.volumeBoost,
    normalizationPreset: audioEnhancements.normalizationPreset,
    onAudioEnhancementChange: handleAudioEnhancementChange,
    onNextEpisode: handleNextEpisode,
    onPrevEpisode: handlePrevEpisode,
    togglePiP: pip.togglePiP,
    onToggleShortcuts: toggleShortcuts,
  });

  // Set document title
  useEffect(() => {
    if (player.title) document.title = `${player.title} - Prexu`;
  }, [player.title]);

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
      {/* Video element */}
      <video
        ref={player.videoRef}
        style={styles.video}
        playsInline
        onClick={handleVideoClick}
      />

      {/* Loading overlay */}
      {player.isLoading && (
        <div style={styles.centerOverlay}>
          <button
            onClick={handleBack}
            style={styles.loadingBackButton}
            aria-label="Go back"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="loading-spinner" />
        </div>
      )}

      {/* Buffering overlay */}
      {!player.isLoading && player.isBuffering && (
        <div style={styles.bufferingOverlay}>
          <div className="loading-spinner" />
        </div>
      )}

      {/* Error overlay */}
      {player.playbackError && (
        <ErrorOverlay
          error={player.playbackError}
          onRetry={player.retry}
          onBack={handleBack}
        />
      )}

      {/* Skip intro/credits button */}
      {activeSegment && !player.isLoading && !player.playbackError && (
        <SkipSegmentButton
          segment={activeSegment}
          onSkip={handleSkipSegment}
          onDismiss={dismissSegment}
          hasNextEpisode={!!handleNextEpisode}
          onNextEpisode={handleNextEpisode}
        />
      )}

      {/* Watch Together participant overlay */}
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

      {/* Keyboard shortcuts overlay */}
      <KeyboardShortcutsOverlay
        visible={showShortcuts}
        onClose={toggleShortcuts}
      />

      {/* Player controls overlay */}
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
          isPiPActive={pip.isPiPActive}
          isPiPSupported={pip.isPiPSupported}
          onTogglePiP={pip.togglePiP}
          queueCount={remainingCount}
          onToggleQueue={toggleQueuePanel}
          serverUri={server?.uri}
          serverToken={server?.accessToken}
          ratingKey={ratingKey}
          onSubtitleDownloaded={player.retry}
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

      {/* Post-play screen */}
      {showPostPlay && nextQueueItem && server && (
        <PostPlayScreen
          nextItem={nextQueueItem}
          onPlayNext={handlePostPlayNext}
          onStop={handlePostPlayStop}
          posterUrl={(path) => getImageUrl(server.uri, server.accessToken, path, 320, 220)}
        />
      )}

      {/* Queue panel */}
      {queuePanelOpen && server && (
        <QueuePanel
          onClose={() => setQueuePanelOpen(false)}
          posterUrl={(path) => getImageUrl(server.uri, server.accessToken, path, 100, 68)}
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
  loadingBackButton: {
    position: "absolute",
    top: "1.5rem",
    left: "1.5rem",
    background: "rgba(0,0,0,0.5)",
    border: "none",
    borderRadius: "50%",
    width: "44px",
    height: "44px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    cursor: "pointer",
    zIndex: 10,
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
};

export default Player;
