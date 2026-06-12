import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { QueueItem } from "../../types/queue";
import { logger } from "../../services/logger";

/**
 * Optional progress info for episodes — "Episode 5 of 13 in Season 2".
 * Parent should pass this when known (e.g. via Plex episode-nav metadata).
 */
export interface PostPlayEpisodeProgress {
  /** 1-indexed episode number within the season. */
  episodeNumber: number;
  /** Total episode count for the season. */
  totalEpisodes: number;
  /** Optional season number — when present we render "in Season N". */
  seasonNumber?: number;
}

/**
 * Optional progress info for playlists — "Item 3 of 7 in Playlist Foo".
 */
export interface PostPlayPlaylistContext {
  /** Display name of the playlist. */
  name: string;
  /** 1-indexed position of the next item within the playlist. */
  position: number;
  /** Total item count in the playlist. */
  total: number;
}

interface PostPlayScreenProps {
  nextItem: QueueItem;
  onPlayNext: () => void;
  onStop: () => void;
  posterUrl: (path: string) => string;
  countdownSeconds?: number;
  /** Persisted preference: when true, countdown auto-fires onPlayNext. */
  autoPlayEnabled: boolean;
  /** Persist a change to the auto-play toggle (writes to user prefs). */
  onAutoPlayChange: (enabled: boolean) => void;

  // ── Optional rich context (parent passes when available) ──
  /** The item that just finished — used to detect cross-show/season transitions. */
  currentItem?: QueueItem;
  /**
   * Explicit "S2 E5" badge string. If omitted we attempt to parse it from
   * `nextItem.subtitle` (the existing convention is "S01E02 · Title").
   */
  seasonEpisodeBadge?: string;
  /** "Episode N of M in Season K" context line. */
  episodeProgress?: PostPlayEpisodeProgress;
  /** "Item N of M in Playlist X" context line — mutually exclusive with episodeProgress. */
  playlistContext?: PostPlayPlaylistContext;
  /** 1–2 line truncated synopsis. */
  synopsis?: string;
  /** Episode air date (ISO YYYY-MM-DD or display-formatted). */
  airDate?: string;
  /** True when the user has already seen the next item (Plex viewCount > 0). */
  watched?: boolean;
  /** Director name(s) — rendered as a "Directed by X" line when present. */
  directors?: string[];
  /** Top cast names — rendered as a "Starring X, Y, Z" line when present. */
  cast?: string[];
  /** Upcoming queue items shown below the main row as a "Coming up" preview. */
  upNext?: QueueItem[];
}

/**
 * Parse "S01E02 · Episode Title" → "S1 E2". Returns null on no match.
 * Used as a graceful fallback when the parent does not pass an explicit badge.
 */
function parseSeasonEpisodeBadge(subtitle: string | undefined): string | null {
  if (!subtitle) return null;
  const match = subtitle.match(/S(\d+)\s*E(\d+)/i);
  if (!match) return null;
  // Strip leading zeros for a cleaner badge ("S01E02" → "S1 E2").
  const season = String(parseInt(match[1], 10));
  const episode = String(parseInt(match[2], 10));
  return `S${season} E${episode}`;
}

/**
 * Strip the "S01E02 · " prefix from an episode subtitle so we can show the
 * raw episode title alongside an explicit badge without duplication.
 */
function stripBadgePrefix(subtitle: string | undefined): string {
  if (!subtitle) return "";
  return subtitle.replace(/^S\d+\s*E\d+\s*[·•\-–—]\s*/i, "").trim();
}

/**
 * Detect a cross-show or new-season transition. Returns a short banner
 * string like "Starting Season 3" or "New Show: Foo" when relevant.
 * Falls back to null when no transition is detected.
 */
function getTransitionBanner(
  current: QueueItem | undefined,
  next: QueueItem,
  nextProgress: PostPlayEpisodeProgress | undefined,
): string | null {
  if (!current || current.type !== "episode" || next.type !== "episode") return null;

  const currentBadge = parseSeasonEpisodeBadge(current.subtitle);
  const nextBadge = parseSeasonEpisodeBadge(next.subtitle);

  // Compare grandparent (show) titles via the prefix of each subtitle is unreliable;
  // QueueItem doesn't carry showTitle directly. For now we surface season changes
  // (when both badges parse and the season number differs).
  if (currentBadge && nextBadge) {
    const curSeason = currentBadge.match(/S(\d+)/i)?.[1];
    const nextSeason = nextBadge.match(/S(\d+)/i)?.[1];
    if (curSeason && nextSeason && curSeason !== nextSeason) {
      const seasonNum = nextProgress?.seasonNumber ?? parseInt(nextSeason, 10);
      return `Starting Season ${seasonNum}`;
    }
  }
  return null;
}

/**
 * Full-screen post-play overlay shown when an episode/item ends.
 * Displays the next item info with a countdown timer that auto-plays.
 * Similar to Plex's "Playing Next" screen.
 */
export default function PostPlayScreen({
  nextItem,
  onPlayNext,
  onStop,
  posterUrl,
  countdownSeconds = 10,
  autoPlayEnabled,
  onAutoPlayChange,
  currentItem,
  seasonEpisodeBadge,
  episodeProgress,
  playlistContext,
  synopsis,
  airDate,
  watched,
  directors,
  cast,
  upNext,
}: PostPlayScreenProps) {
  const [countdown, setCountdown] = useState(countdownSeconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    logger.debug("postplay", "mount", {
      nextRatingKey: nextItem.ratingKey,
      type: nextItem.type,
      autoPlayEnabled,
      hasEpisodeProgress: !!episodeProgress,
      hasPlaylistContext: !!playlistContext,
    });
    // Intentionally only logging on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoPlayEnabled) return;
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoPlayEnabled]);

  // Auto-play when countdown reaches 0
  useEffect(() => {
    if (countdown === 0 && autoPlayEnabled) {
      logger.debug("postplay", "countdown_fire_autoplay");
      onPlayNext();
    }
  }, [countdown, autoPlayEnabled, onPlayNext]);

  const handleToggleAutoPlay = useCallback(() => {
    if (autoPlayEnabled && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    logger.debug("postplay", "toggle_autoplay", { next: !autoPlayEnabled });
    onAutoPlayChange(!autoPlayEnabled);
  }, [autoPlayEnabled, onAutoPlayChange]);

  // Keyboard: Enter to play now, Escape to stop
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onPlayNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onStop();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onPlayNext, onStop]);

  const progressPct = ((countdownSeconds - countdown) / countdownSeconds) * 100;

  // Derive episode badge: prefer explicit prop, else parse from subtitle.
  const badge = useMemo(
    () => seasonEpisodeBadge ?? parseSeasonEpisodeBadge(nextItem.subtitle),
    [seasonEpisodeBadge, nextItem.subtitle],
  );

  // For episodes, derive the cleaner "episode title" line by stripping the
  // S/E prefix. For movies/other we just use the subtitle as-is.
  const cleanSubtitle = useMemo(() => {
    if (nextItem.type !== "episode") return nextItem.subtitle;
    return stripBadgePrefix(nextItem.subtitle) || nextItem.subtitle;
  }, [nextItem.type, nextItem.subtitle]);

  const transitionBanner = useMemo(
    () => getTransitionBanner(currentItem, nextItem, episodeProgress),
    [currentItem, nextItem, episodeProgress],
  );

  const progressLine = useMemo<string | null>(() => {
    if (playlistContext) {
      return `Item ${playlistContext.position} of ${playlistContext.total} in ${playlistContext.name}`;
    }
    if (episodeProgress) {
      const { episodeNumber, totalEpisodes, seasonNumber } = episodeProgress;
      const season = seasonNumber != null ? ` in Season ${seasonNumber}` : "";
      return `Episode ${episodeNumber} of ${totalEpisodes}${season}`;
    }
    return null;
  }, [episodeProgress, playlistContext]);

  const durationMin = Math.round(nextItem.duration / 60000);

  return (
    <div
      style={styles.container}
      role="dialog"
      aria-modal="true"
      aria-label="Playing next"
    >
      <div style={styles.content}>
        {transitionBanner && (
          <div style={styles.transitionBanner}>{transitionBanner}</div>
        )}

        <div style={styles.headerLabel}>PLAYING NEXT</div>

        <div style={styles.mainRow}>
          {/* Hero thumbnail with watched chip */}
          <div style={styles.thumbContainer}>
            <img
              src={posterUrl(nextItem.thumb)}
              alt=""
              style={styles.thumb}
            />
            {watched && (
              <div style={styles.watchedChip} aria-label="Already watched">
                WATCHED
              </div>
            )}
          </div>

          {/* Item details */}
          <div style={styles.details}>
            <div style={styles.badgeRow}>
              {badge && nextItem.type === "episode" && (
                <span style={styles.seasonEpisodeBadge}>{badge}</span>
              )}
              {progressLine && (
                <span style={styles.progressLine}>{progressLine}</span>
              )}
            </div>
            <h2 style={styles.title}>{nextItem.title}</h2>
            {cleanSubtitle && (
              <div style={styles.subtitle}>{cleanSubtitle}</div>
            )}
            {synopsis && <p style={styles.synopsis}>{synopsis}</p>}
            <div style={styles.metaRow}>
              {durationMin > 0 && <span>{durationMin} min</span>}
              {airDate && <span style={styles.metaDot}>·</span>}
              {airDate && <span>{airDate}</span>}
            </div>
            {directors && directors.length > 0 && (
              <div style={styles.creditLine}>
                <span style={styles.creditLabel}>Directed by</span>{" "}
                {directors.join(", ")}
              </div>
            )}
            {cast && cast.length > 0 && (
              <div style={styles.creditLine}>
                <span style={styles.creditLabel}>Starring</span>{" "}
                {cast.join(", ")}
              </div>
            )}
          </div>
        </div>

        {/* Coming up — small horizontal strip of the next 2-4 queue items
            after `nextItem`. Helps fill the larger overlay area without
            making the screen feel sparse. */}
        {upNext && upNext.length > 0 && (
          <div style={styles.upNextSection}>
            <div style={styles.upNextLabel}>COMING UP</div>
            <div style={styles.upNextRow}>
              {upNext.map((item) => {
                const itemBadge =
                  item.type === "episode"
                    ? parseSeasonEpisodeBadge(item.subtitle)
                    : null;
                return (
                  <div key={item.ratingKey} style={styles.upNextCard}>
                    <img
                      src={posterUrl(item.thumb)}
                      alt=""
                      style={styles.upNextThumb}
                      loading="lazy"
                    />
                    <div style={styles.upNextInfo}>
                      {itemBadge && (
                        <span style={styles.upNextBadge}>{itemBadge}</span>
                      )}
                      <span style={styles.upNextTitle}>{item.title}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Countdown progress bar — full-width, more visible than the old 48x48 ring */}
        {autoPlayEnabled && (
          <div style={styles.countdownSection} aria-live="polite">
            <div style={styles.countdownLabelRow}>
              <span style={styles.countdownLabel}>
                Auto-playing in {countdown}s
              </span>
            </div>
            <div style={styles.countdownTrack}>
              <div
                style={{ ...styles.countdownFill, width: `${progressPct}%` }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={countdownSeconds}
                aria-valuenow={countdownSeconds - countdown}
                aria-label="Auto-play countdown"
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={styles.actions}>
          <label style={styles.autoPlayToggle}>
            <input
              type="checkbox"
              checked={autoPlayEnabled}
              onChange={handleToggleAutoPlay}
              style={{ accentColor: "var(--accent)" }}
            />
            AUTO PLAY ON
          </label>
          <div style={styles.buttonRow}>
            <button
              type="button"
              onClick={onPlayNext}
              style={styles.playNowButton}
            >
              Play Now
            </button>
            <button
              type="button"
              onClick={onStop}
              style={styles.stopButton}
            >
              Stop
            </button>
          </div>
        </div>

        <div style={styles.shortcutHint}>
          Enter to play · Esc to stop
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    // Full-screen overlay in opaque Prexu navy. The paused video frame
    // underneath is fully covered so the user sees a clean transition
    // card. Player chrome (seek bar, transport controls) remains visible
    // above this layer's z-index so scrubbing past EOF still works.
    position: "absolute",
    inset: 0,
    background: "var(--bg-primary)",
    zIndex: 30,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    padding: "2.5rem 3rem",
    animation: "fadeIn 0.3s ease-out",
    overflow: "hidden",
  },
  content: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
  },
  transitionBanner: {
    display: "inline-block",
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.7rem",
    fontWeight: 700,
    letterSpacing: "0.1em",
    padding: "0.3rem 0.65rem",
    borderRadius: "999px",
    marginBottom: "0.85rem",
    textTransform: "uppercase",
  },
  headerLabel: {
    fontSize: "0.8rem",
    fontWeight: 700,
    color: "var(--text-secondary)",
    letterSpacing: "0.1em",
    marginBottom: "1.25rem",
  },
  mainRow: {
    display: "flex",
    gap: "2rem",
    alignItems: "flex-start",
    flex: 1,
    minHeight: 0,
  },
  thumbContainer: {
    position: "relative",
    flexShrink: 0,
  },
  thumb: {
    width: "360px",
    height: "203px",
    borderRadius: "10px",
    objectFit: "cover",
    boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  },
  watchedChip: {
    position: "absolute",
    top: "0.6rem",
    left: "0.6rem",
    background: "rgba(0,0,0,0.75)",
    color: "var(--text-primary)",
    fontSize: "0.65rem",
    fontWeight: 700,
    letterSpacing: "0.08em",
    padding: "0.25rem 0.55rem",
    borderRadius: "4px",
  },
  details: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    flex: 1,
    minWidth: 0,
  },
  badgeRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "0.15rem",
  },
  seasonEpisodeBadge: {
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.85rem",
    fontWeight: 700,
    padding: "0.2rem 0.55rem",
    borderRadius: "4px",
    letterSpacing: "0.02em",
  },
  progressLine: {
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    letterSpacing: "0.02em",
  },
  title: {
    fontSize: "1.75rem",
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
    lineHeight: 1.2,
  },
  subtitle: {
    fontSize: "1rem",
    color: "var(--text-secondary)",
  },
  synopsis: {
    fontSize: "0.95rem",
    color: "var(--text-secondary)",
    lineHeight: 1.55,
    margin: "0.5rem 0 0 0",
    display: "-webkit-box",
    WebkitLineClamp: 4,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  metaRow: {
    display: "flex",
    gap: "0.4rem",
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    marginTop: "0.6rem",
    alignItems: "center",
  },
  metaDot: {
    opacity: 0.6,
  },
  creditLine: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    marginTop: "0.35rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  creditLabel: {
    fontWeight: 600,
    color: "var(--text-primary)",
    opacity: 0.7,
  },
  upNextSection: {
    marginTop: "1.25rem",
  },
  upNextLabel: {
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "var(--text-secondary)",
    letterSpacing: "0.1em",
    marginBottom: "0.6rem",
  },
  upNextRow: {
    display: "flex",
    gap: "0.85rem",
    overflow: "hidden",
  },
  upNextCard: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    flex: "0 0 200px",
    minWidth: 0,
  },
  upNextThumb: {
    width: "200px",
    height: "112px",
    borderRadius: "6px",
    objectFit: "cover",
    background: "var(--bg-card)",
  },
  upNextInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    minWidth: 0,
  },
  upNextBadge: {
    alignSelf: "flex-start",
    background: "rgba(229, 160, 13, 0.15)",
    color: "var(--accent)",
    fontSize: "0.65rem",
    fontWeight: 700,
    padding: "0.1rem 0.4rem",
    borderRadius: "3px",
    letterSpacing: "0.04em",
  },
  upNextTitle: {
    fontSize: "0.85rem",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  countdownSection: {
    marginTop: "1.5rem",
  },
  countdownLabelRow: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "0.4rem",
  },
  countdownLabel: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    letterSpacing: "0.05em",
  },
  countdownTrack: {
    width: "100%",
    height: "4px",
    background: "rgba(255,255,255,0.12)",
    borderRadius: "2px",
    overflow: "hidden",
  },
  countdownFill: {
    height: "100%",
    background: "var(--accent)",
    borderRadius: "2px",
    transition: "width 1s linear",
  },
  actions: {
    marginTop: "1.5rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  autoPlayToggle: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "var(--accent)",
    letterSpacing: "0.05em",
    cursor: "pointer",
  },
  buttonRow: {
    display: "flex",
    gap: "0.75rem",
  },
  playNowButton: {
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.95rem",
    fontWeight: 600,
    padding: "0.6rem 1.5rem",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
  },
  stopButton: {
    background: "rgba(255,255,255,0.1)",
    color: "var(--text-primary)",
    fontSize: "0.95rem",
    fontWeight: 500,
    padding: "0.6rem 1.5rem",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.15)",
    cursor: "pointer",
  },
  shortcutHint: {
    marginTop: "1.25rem",
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
    letterSpacing: "0.04em",
    opacity: 0.7,
  },
};
