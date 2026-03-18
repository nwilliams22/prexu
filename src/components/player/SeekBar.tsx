/**
 * Seek bar UI — progress track, buffered range, draggable thumb,
 * hover tooltip, and flanking time labels.
 */

import type { UseSeekBarResult } from "../../hooks/useSeekBar";
import { formatTime, getEndsAt } from "../../utils/time-format";

interface SeekBarProps {
  seekBar: UseSeekBarResult;
  currentTime: number;
  duration: number;
  mobile: boolean;
}

function SeekBar({ seekBar, currentTime, duration, mobile }: SeekBarProps) {
  return (
    <div style={styles.seekRow}>
      <span style={styles.seekTimeLabel}>{formatTime(currentTime)}</span>
      <div
        ref={seekBar.seekBarRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration)}
        aria-valuenow={Math.floor(currentTime)}
        aria-valuetext={formatTime(currentTime)}
        tabIndex={0}
        style={{
          ...styles.seekBarContainer,
          ...(mobile ? { height: "32px" } : {}),
        }}
        onMouseDown={seekBar.handleSeekMouseDown}
        onMouseMove={seekBar.handleSeekHover}
        onMouseLeave={seekBar.clearHover}
        onTouchStart={seekBar.handleTouchStart}
        onTouchMove={seekBar.handleTouchMove}
        onTouchEnd={seekBar.handleTouchEnd}
      >
        {/* Buffered range */}
        <div
          style={{
            ...styles.seekBarBuffered,
            width: `${seekBar.bufferedPercent}%`,
          }}
        />
        {/* Progress */}
        <div
          style={{
            ...styles.seekBarProgress,
            width: `${seekBar.progressPercent}%`,
          }}
        />
        {/* Thumb */}
        <div
          style={{
            ...styles.seekBarThumb,
            left: `${seekBar.progressPercent}%`,
            ...(mobile
              ? { width: "20px", height: "20px", marginTop: "-10px", marginLeft: "-10px" }
              : {}),
          }}
        />
        {/* Hover tooltip */}
        {seekBar.hoverTime !== null && (
          <div
            style={{
              ...styles.seekTooltip,
              left: `${seekBar.hoverX}px`,
            }}
          >
            {formatTime(seekBar.hoverTime)}
          </div>
        )}
      </div>
      <div style={styles.seekTimeRight}>
        <span style={styles.seekTimeLabel}>
          -{formatTime(duration - currentTime)}
        </span>
        {duration > 0 && (
          <span style={styles.endsAt}>
            Ends {getEndsAt(currentTime, duration)}
          </span>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  seekRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "0.5rem",
  },
  seekTimeLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: "0.8rem",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    minWidth: "3.5rem",
    textAlign: "center",
  },
  seekBarContainer: {
    position: "relative",
    height: "20px",
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    flex: 1,
  },
  seekBarBuffered: {
    position: "absolute",
    top: "50%",
    left: 0,
    height: "4px",
    marginTop: "-2px",
    background: "rgba(255,255,255,0.25)",
    borderRadius: "2px",
    pointerEvents: "none",
  },
  seekBarProgress: {
    position: "absolute",
    top: "50%",
    left: 0,
    height: "4px",
    marginTop: "-2px",
    background: "var(--accent)",
    borderRadius: "2px",
    pointerEvents: "none",
  },
  seekBarThumb: {
    position: "absolute",
    top: "50%",
    width: "14px",
    height: "14px",
    marginTop: "-7px",
    marginLeft: "-7px",
    background: "var(--accent)",
    borderRadius: "50%",
    pointerEvents: "none",
    boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
  },
  seekTooltip: {
    position: "absolute",
    bottom: "22px",
    transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.85)",
    color: "var(--text-primary)",
    fontSize: "0.75rem",
    padding: "2px 6px",
    borderRadius: "3px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  seekTimeRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.1rem",
    minWidth: "3.5rem",
  },
  endsAt: {
    color: "rgba(255,255,255,0.5)",
    fontSize: "0.75rem",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
};

export default SeekBar;
