/**
 * Custom div-based scrub bar for the mini player.
 *
 * Uses a 20px-tall transparent hit area around a 4px visible track so the
 * user can reliably grab from anywhere in the band. Seek fraction is computed
 * from the TRACK element's getBoundingClientRect() — not the hit area — to
 * avoid the erratic seek jumps seen when the layout region is wider than the
 * visible track (prexu-acc fix).
 *
 * Pointer capture keeps the drag live when the cursor leaves the hit area.
 * IPC is throttled to ~30 Hz (33 ms) on pointermove; pointerup always commits
 * the exact release position (prexu-bgz.10).
 *
 * Time labels (current position / remaining) are shown flanking the bar when
 * the player width is wide enough (prexu-oj5). Pass showTimeLabels=false to
 * suppress them.
 */

import type React from "react";
import { useRef, useCallback } from "react";
import { formatTime } from "../../utils/time-format";
import { logger } from "../../services/logger";

/** Throttle window for mid-drag IPC seeks — mirrors RESIZE_IPC_THROTTLE_MS in
 *  MiniChrome (prexu-bgz.10 / prexu-8qk). */
const SCRUB_IPC_THROTTLE_MS = 33;

interface MiniScrubBarProps {
  /** Playback position in seconds. */
  currentTime: number;
  /** Total duration in seconds. */
  duration: number;
  /** Remaining seconds (pre-computed by parent to avoid re-deriving it). */
  remaining: number;
  /** Seek to an absolute position in seconds (WT-aware variant from parent). */
  onSeek: (seconds: number) => void;
  /** True when the bar and labels should be opaque and interactive. */
  visible: boolean;
  /** Whether to show the flanking time labels. Parent gates this on player
   *  width >= TIME_LABEL_MIN_WIDTH. */
  showTimeLabels: boolean;
  /** Called on any meaningful interaction to reset the auto-hide timer. */
  onActivity: () => void;
}

const styles = {
  // Transparent hit-area wrapper: 20px tall so the user can grab from any
  // vertical position in a generous band, regardless of the 4px visible track.
  scrubWrap: {
    position: "absolute" as const,
    bottom: 56,
    left: 12,
    right: 12,
    transition: "opacity 0.2s ease",
    zIndex: 2,
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  scrubHitArea: {
    flex: 1 as const,
    minWidth: 0,
    position: "relative" as const,
    height: 20,
    cursor: "pointer",
    display: "flex" as const,
    alignItems: "center" as const,
  },
  scrubTrack: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    top: "50%" as const,
    height: 4,
    marginTop: -2,
    background: "rgba(255, 255, 255, 0.30)",
    borderRadius: 2,
    overflow: "hidden" as const,
    pointerEvents: "none" as const,
  },
  scrubFill: {
    position: "absolute" as const,
    left: 0,
    top: 0,
    bottom: 0,
    background: "white",
    pointerEvents: "none" as const,
  },
  scrubThumb: {
    position: "absolute" as const,
    top: "50%" as const,
    width: 12,
    height: 12,
    marginTop: -6,
    marginLeft: -6,
    background: "white",
    borderRadius: "50%" as const,
    pointerEvents: "none" as const,
    boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
  },
  scrubLabel: {
    color: "rgba(255, 255, 255, 0.85)",
    fontSize: 11,
    fontVariantNumeric: "tabular-nums" as const,
    textShadow: "0 1px 2px rgba(0, 0, 0, 0.7)",
    flexShrink: 0,
    minWidth: 36,
  },
};

export default function MiniScrubBar({
  currentTime,
  duration,
  remaining,
  onSeek,
  visible,
  showTimeLabels,
  onActivity,
}: MiniScrubBarProps) {
  const scrubTrackRef = useRef<HTMLDivElement | null>(null);
  const scrubDraggingRef = useRef(false);
  const lastScrubIpcRef = useRef<number>(0);

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const track = scrubTrackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const fraction = (clientX - rect.left) / rect.width;
      const clamped = Math.max(0, Math.min(1, fraction));
      const target = Math.max(0, Math.min(duration, clamped * duration));
      logger.debug("player:minimize", "mini-seek", { from: currentTime, to: target });
      onSeek(target);
    },
    [currentTime, duration, onSeek],
  );

  const handleScrubPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onActivity();
      scrubDraggingRef.current = true;
      const target = e.currentTarget as HTMLDivElement;
      if (typeof target.setPointerCapture === "function") {
        target.setPointerCapture(e.pointerId);
      }
      lastScrubIpcRef.current = Date.now();
      seekFromPointer(e.clientX);
    },
    [onActivity, seekFromPointer],
  );

  const handleScrubPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubDraggingRef.current) return;
      const now = Date.now();
      if (now - lastScrubIpcRef.current >= SCRUB_IPC_THROTTLE_MS) {
        lastScrubIpcRef.current = now;
        seekFromPointer(e.clientX);
      }
    },
    [seekFromPointer],
  );

  const handleScrubPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubDraggingRef.current) return;
      scrubDraggingRef.current = false;
      seekFromPointer(e.clientX);
    },
    [seekFromPointer],
  );

  const fillPct = `${Math.min(100, (Math.min(currentTime, duration) / duration) * 100)}%`;

  return (
    <div
      style={{
        ...styles.scrubWrap,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
      data-testid="mini-chrome-scrub-wrap"
      data-mini-no-drag="true"
    >
      {showTimeLabels && (
        <span
          style={{ ...styles.scrubLabel, textAlign: "right" }}
          data-testid="mini-chrome-time-current"
          aria-hidden
        >
          {formatTime(currentTime)}
        </span>
      )}
      <div
        style={styles.scrubHitArea}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration)}
        aria-valuenow={Math.floor(Math.min(currentTime, duration))}
        aria-valuetext={formatTime(Math.min(currentTime, duration))}
        tabIndex={0}
        onPointerDown={handleScrubPointerDown}
        onPointerMove={handleScrubPointerMove}
        onPointerUp={handleScrubPointerUp}
        data-testid="mini-chrome-scrub"
      >
        {/* Visible 4px track — only used for rendering, not hit-testing. */}
        <div style={styles.scrubTrack} ref={scrubTrackRef}>
          <div style={{ ...styles.scrubFill, width: fillPct }} />
        </div>
        <div style={{ ...styles.scrubThumb, left: fillPct }} />
      </div>
      {showTimeLabels && (
        <span
          style={styles.scrubLabel}
          data-testid="mini-chrome-time-remaining"
          aria-hidden
        >
          {`-${formatTime(remaining)}`}
        </span>
      )}
    </div>
  );
}
