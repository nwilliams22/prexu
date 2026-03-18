import { useNavigate } from "react-router-dom";
import { useBreakpoint, isMobile } from "../../hooks/useBreakpoint";
import WatchTogetherButton from "../WatchTogetherButton";
import WatchedToggleButton from "../WatchedToggleButton";
import { formatResumeTime, decodeHtmlEntities } from "../../utils/media-helpers";
import { detailStyles } from "../../utils/detail-styles";
import {
  buildRatingBadges,
  TomatoIcon,
  PopcornIcon,
  ImdbIcon,
  TmdbIcon,
} from "../../utils/rating-badges";
import type {
  PlexMovie,
  PlexShow,
  PlexSeason,
  PlexEpisode,
  PlexRating,
} from "../../types/library";

type HeroItem = PlexMovie | PlexShow | PlexSeason | PlexEpisode;

interface ItemHeroSectionProps {
  item: HeroItem;
  artUrl: (path: string) => string;
  posterUrl: (path: string) => string;
  isAdmin: boolean;
  onFixMatch: () => void;
  refreshItem: () => void;
  /** For season detail: fade during season switch */
  seasonFading?: boolean;
  /** For season: parent show info */
  parentShow?: { art?: string } | null;
}

export default function ItemHeroSection({
  item,
  artUrl,
  posterUrl,
  isAdmin,
  onFixMatch,
  refreshItem,
  seasonFading,
  parentShow,
}: ItemHeroSectionProps) {
  const navigate = useNavigate();
  const bp = useBreakpoint();
  const mobile = isMobile(bp);

  const formatDuration = (ms: number): string => {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const renderRatings = (
    ratings: PlexRating[] | undefined,
    rating: number,
    audienceRating: number,
    ratingImage?: string,
    audienceRatingImage?: string
  ) => {
    const badges = buildRatingBadges(ratings, rating, audienceRating, ratingImage, audienceRatingImage);
    return badges.map((b) => (
      <span key={b.source} style={styles.ratingBadge} title={`${b.label} rating`}>
        {b.source === "rt-critic" && <TomatoIcon />}
        {b.source === "rt-audience" && <PopcornIcon />}
        {b.source === "imdb" && <ImdbIcon />}
        {b.source === "tmdb" && <TmdbIcon />}
        {b.source === "generic" && <span style={styles.ratingLabel}>{b.label}</span>}
        {" "}{b.display}
      </span>
    ));
  };

  // ── Movie ──
  if (item.type === "movie") {
    const movie = item as PlexMovie;
    return (
      <>
        <img
          src={movie.art ? artUrl(movie.art) : posterUrl(movie.thumb)}
          alt=""
          loading="lazy"
          style={movie.art ? styles.pageBgArt : styles.pageBgArtFallback}
        />
        <div style={styles.pageBgOverlay} />

        <div style={{
          ...styles.heroContent,
          ...(mobile ? { flexDirection: "column", alignItems: "center" } : {}),
        }}>
          <img
            src={posterUrl(movie.thumb)}
            alt={movie.title}
            style={{
              ...styles.heroPoster,
              width: mobile ? "160px" : bp === "large" ? "280px" : "240px",
              ...(mobile ? { alignSelf: "center" } : {}),
            }}
          />
          <div style={{
            ...styles.heroInfo,
            ...(mobile ? { alignItems: "center" } : {}),
          }}>
            <h1 style={{
              ...styles.heroTitle,
              fontSize: mobile ? "1.6rem" : bp === "large" ? "2.8rem" : "2.4rem",
              ...(mobile ? { textAlign: "center" } : {}),
            }}>{movie.title}</h1>
            <div style={{
              ...styles.metaRow,
              ...(mobile ? { justifyContent: "center" } : {}),
            }}>
              {movie.year && <span>{movie.year}</span>}
              {movie.contentRating && (
                <span style={styles.rating}>{movie.contentRating}</span>
              )}
              {movie.duration && <span>{formatDuration(movie.duration)}</span>}
              {renderRatings(
                movie.Rating,
                movie.rating,
                movie.audienceRating,
                movie.ratingImage,
                movie.audienceRatingImage
              )}
            </div>
            {movie.Genre && movie.Genre.length > 0 && (
              <div style={styles.genreRow}>
                {movie.Genre.map((g) => (
                  <span key={g.tag} style={styles.genreTag}>{g.tag}</span>
                ))}
              </div>
            )}
            {movie.tagline && (
              <p style={styles.tagline}>{movie.tagline}</p>
            )}
            <div style={{
              ...styles.buttonRow,
              ...(mobile ? { justifyContent: "center" } : {}),
            }}>
              {movie.viewOffset && movie.viewOffset > 0 ? (
                <>
                  <button
                    onClick={() => navigate(`/play/${movie.ratingKey}`)}
                    style={styles.playButton}
                  >
                    &#9654; Resume from {formatResumeTime(movie.viewOffset)}
                  </button>
                  <button
                    onClick={() => navigate(`/play/${movie.ratingKey}?offset=0`)}
                    style={styles.secondaryButton}
                  >
                    Play from Beginning
                  </button>
                </>
              ) : (
                <button
                  onClick={() => navigate(`/play/${movie.ratingKey}`)}
                  style={styles.playButton}
                >
                  &#9654; Play
                </button>
              )}
              <WatchTogetherButton
                ratingKey={movie.ratingKey}
                title={movie.title}
                mediaType="movie"
              />
              <WatchedToggleButton
                ratingKey={movie.ratingKey}
                isWatched={(movie.viewCount ?? 0) > 0}
                onToggled={refreshItem}
              />
              {isAdmin && (
                <button
                  onClick={onFixMatch}
                  style={styles.fixMatchButton}
                  title="Fix Match"
                >
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx={11} cy={11} r={8} />
                    <line x1={21} y1={21} x2={16.65} y2={16.65} />
                  </svg>
                  Fix Match
                </button>
              )}
            </div>
            {movie.summary && (
              <p style={{
                ...styles.summary,
                maxWidth: bp === "large" ? "1000px" : "800px",
                marginTop: "0.25rem",
              }}>{decodeHtmlEntities(movie.summary)}</p>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── Show ──
  if (item.type === "show") {
    const show = item as PlexShow;
    return (
      <>
        <img
          src={show.art ? artUrl(show.art) : posterUrl(show.thumb)}
          alt=""
          loading="lazy"
          style={show.art ? styles.pageBgArt : styles.pageBgArtFallback}
        />
        <div style={styles.pageBgOverlay} />

        <div style={{
          ...styles.heroContent,
          ...(mobile ? { flexDirection: "column", alignItems: "center" } : {}),
        }}>
          <img
            src={posterUrl(show.thumb)}
            alt={show.title}
            style={{
              ...styles.heroPoster,
              width: mobile ? "160px" : bp === "large" ? "280px" : "240px",
              ...(mobile ? { alignSelf: "center" } : {}),
            }}
          />
          <div style={{
            ...styles.heroInfo,
            ...(mobile ? { alignItems: "center" } : {}),
          }}>
            <h1 style={{
              ...styles.heroTitle,
              fontSize: mobile ? "1.6rem" : bp === "large" ? "2.8rem" : "2.4rem",
              ...(mobile ? { textAlign: "center" } : {}),
            }}>{show.title}</h1>
            <div style={{
              ...styles.metaRow,
              ...(mobile ? { justifyContent: "center" } : {}),
            }}>
              {show.year && <span>{show.year}</span>}
              {show.contentRating && (
                <span style={styles.rating}>{show.contentRating}</span>
              )}
              <span>
                {show.childCount} season{show.childCount !== 1 ? "s" : ""}
              </span>
              <span>{show.leafCount} episodes</span>
              {renderRatings(
                show.Rating,
                show.rating,
                show.audienceRating,
                show.ratingImage,
                show.audienceRatingImage
              )}
            </div>
            {show.Genre && show.Genre.length > 0 && (
              <div style={styles.genreRow}>
                {show.Genre.map((g) => (
                  <span key={g.tag} style={styles.genreTag}>{g.tag}</span>
                ))}
              </div>
            )}
            {isAdmin && (
              <div style={{
                ...styles.buttonRow,
                ...(mobile ? { justifyContent: "center" } : {}),
              }}>
                <button
                  onClick={onFixMatch}
                  style={styles.fixMatchButton}
                  title="Fix Match"
                >
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx={11} cy={11} r={8} />
                    <line x1={21} y1={21} x2={16.65} y2={16.65} />
                  </svg>
                  Fix Match
                </button>
              </div>
            )}
            {show.summary && (
              <p style={{
                ...styles.summary,
                maxWidth: bp === "large" ? "1000px" : "800px",
                marginTop: "0.25rem",
              }}>{decodeHtmlEntities(show.summary)}</p>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── Season ──
  if (item.type === "season") {
    const season = item as PlexSeason;
    const bgArt = parentShow?.art;
    return (
      <>
        <img
          src={bgArt ? artUrl(bgArt) : posterUrl(season.parentThumb || season.thumb)}
          alt=""
          loading="lazy"
          style={bgArt ? styles.pageBgArt : styles.pageBgArtFallback}
        />
        <div style={styles.pageBgOverlay} />

        <div style={{
          ...styles.heroContent,
          ...(mobile ? { flexDirection: "column", alignItems: "center" } : {}),
          opacity: seasonFading ? 0 : 1,
          transition: "opacity 0.15s ease",
        }}>
          <img
            src={posterUrl(season.thumb)}
            alt={season.title}
            style={{
              ...styles.heroPoster,
              width: mobile ? "160px" : bp === "large" ? "240px" : "200px",
              ...(mobile ? { alignSelf: "center" } : {}),
            }}
          />
          <div style={{
            ...styles.heroInfo,
            ...(mobile ? { alignItems: "center" } : {}),
          }}>
            <button
              onClick={() => navigate(`/item/${season.parentRatingKey}`)}
              style={styles.showLink}
            >
              {season.parentTitle}
            </button>
            <h1 style={{
              ...styles.heroTitle,
              fontSize: mobile ? "1.6rem" : bp === "large" ? "2.4rem" : "2rem",
              ...(mobile ? { textAlign: "center" } : {}),
            }}>
              {season.title}
            </h1>
            <div style={{
              ...styles.metaRow,
              ...(mobile ? { justifyContent: "center" } : {}),
            }}>
              <span>{season.leafCount} episode{season.leafCount !== 1 ? "s" : ""}</span>
              {season.viewedLeafCount > 0 && (
                <span>
                  {season.viewedLeafCount === season.leafCount
                    ? "All watched"
                    : `${season.viewedLeafCount} watched`}
                </span>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Episode ──
  if (item.type === "episode") {
    const ep = item as PlexEpisode;
    const mediaInfo = ep.Media?.[0];
    const epThumbSrc = posterUrl(ep.thumb); // caller can override if needed

    const mediaDetails: { label: string; value: string }[] = [];
    if (ep.Director && ep.Director.length > 0) {
      mediaDetails.push({ label: "Directed by", value: ep.Director.map((d) => d.tag).join(", ") });
    }
    if (ep.Writer && ep.Writer.length > 0) {
      mediaDetails.push({ label: "Written by", value: ep.Writer.map((w) => w.tag).join(", ") });
    }
    if (mediaInfo) {
      if (mediaInfo.videoResolution || mediaInfo.videoCodec) {
        const parts = [];
        if (mediaInfo.videoResolution) parts.push(mediaInfo.videoResolution.toUpperCase());
        if (mediaInfo.videoCodec) parts.push(mediaInfo.videoCodec.toUpperCase());
        mediaDetails.push({ label: "Video", value: parts.join(" \u00b7 ") });
      }
      if (mediaInfo.audioCodec) {
        const channels = mediaInfo.audioChannels > 0
          ? ` \u00b7 ${mediaInfo.audioChannels === 6 ? "5.1" : mediaInfo.audioChannels === 8 ? "7.1" : `${mediaInfo.audioChannels}ch`}`
          : "";
        mediaDetails.push({ label: "Audio", value: `${mediaInfo.audioCodec.toUpperCase()}${channels}` });
      }
    }

    return (
      <>
        <img
          src={(ep.grandparentArt || ep.art) ? artUrl(ep.grandparentArt || ep.art) : posterUrl(ep.thumb)}
          alt=""
          loading="lazy"
          style={(ep.grandparentArt || ep.art) ? styles.pageBgArt : styles.pageBgArtFallback}
        />
        <div style={styles.pageBgOverlay} />

        <div style={{
          ...styles.heroContent,
          padding: mobile ? "2rem 1.5rem 1.5rem" : "3.5rem 2.5rem 2.5rem",
          ...(mobile ? { flexDirection: "column", alignItems: "center" } : {}),
        }}>
          <img
            src={epThumbSrc}
            alt={ep.title}
            style={{
              ...styles.episodeHeroThumb,
              width: mobile ? "100%" : bp === "large" ? "480px" : "420px",
              maxWidth: mobile ? "100%" : undefined,
            }}
          />
          <div style={{
            ...styles.heroInfo,
            gap: "0.75rem",
            ...(mobile ? { alignItems: "center" } : {}),
          }}>
            <div style={{
              display: "flex",
              gap: "0.25rem",
              alignItems: "center",
              ...(mobile ? { justifyContent: "center" } : {}),
            }}>
              <button
                onClick={() => navigate(`/item/${ep.grandparentRatingKey}`)}
                style={styles.showLink}
              >
                {ep.grandparentTitle}
              </button>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>&rsaquo;</span>
              <button
                onClick={() => navigate(`/item/${ep.parentRatingKey}`)}
                style={styles.showLink}
              >
                {ep.parentTitle}
              </button>
            </div>
            <h1 style={{
              ...styles.heroTitle,
              fontSize: mobile ? "1.6rem" : bp === "large" ? "2.8rem" : "2.4rem",
              ...(mobile ? { textAlign: "center" } : {}),
            }}>{ep.title}</h1>
            <div style={{
              ...styles.metaRow,
              ...(mobile ? { justifyContent: "center" } : {}),
            }}>
              <span>
                S{String(ep.parentIndex).padStart(2, "0")}E
                {String(ep.index).padStart(2, "0")}
              </span>
              {ep.originallyAvailableAt && (
                <span>{ep.originallyAvailableAt}</span>
              )}
              {ep.duration && <span>{formatDuration(ep.duration)}</span>}
              {ep.contentRating && (
                <span style={styles.rating}>{ep.contentRating}</span>
              )}
              {renderRatings(
                ep.Rating,
                ep.rating ?? 0,
                ep.audienceRating ?? 0,
                ep.ratingImage,
                ep.audienceRatingImage
              )}
            </div>

            {ep.summary && (
              <p style={{
                ...styles.summary,
                maxWidth: bp === "large" ? "800px" : "650px",
              }}>{decodeHtmlEntities(ep.summary)}</p>
            )}

            <div style={{
              ...styles.buttonRow,
              marginTop: "0.5rem",
              ...(mobile ? { justifyContent: "center" } : {}),
            }}>
              {ep.viewOffset && ep.viewOffset > 0 ? (
                <>
                  <button
                    onClick={() => navigate(`/play/${ep.ratingKey}`)}
                    style={styles.playButton}
                  >
                    &#9654; Resume from {formatResumeTime(ep.viewOffset)}
                  </button>
                  <button
                    onClick={() => navigate(`/play/${ep.ratingKey}?offset=0`)}
                    style={styles.secondaryButton}
                  >
                    Play from Beginning
                  </button>
                </>
              ) : (
                <button
                  onClick={() => navigate(`/play/${ep.ratingKey}`)}
                  style={styles.playButton}
                >
                  &#9654; Play
                </button>
              )}
              <WatchTogetherButton
                ratingKey={ep.ratingKey}
                title={`${ep.grandparentTitle} \u2014 ${ep.title}`}
                mediaType="episode"
              />
              <WatchedToggleButton
                ratingKey={ep.ratingKey}
                isWatched={(ep.viewCount ?? 0) > 0}
                onToggled={refreshItem}
              />
            </div>

            {mediaDetails.length > 0 && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "0.3rem 1.25rem",
                marginTop: "0.5rem",
                ...(mobile ? { justifyItems: "center", gridTemplateColumns: "1fr" } : {}),
              }}>
                {mediaDetails.map((d) => (
                  mobile ? (
                    <span key={d.label} style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                      <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{d.label}:</span> {d.value}
                    </span>
                  ) : (
                    <span key={d.label} style={{ display: "contents" }}>
                      <span style={{
                        fontSize: "0.85rem",
                        color: "var(--text-secondary)",
                        textAlign: "right",
                      }}>{d.label}</span>
                      <span style={{
                        fontSize: "0.85rem",
                        color: "var(--text-primary)",
                      }}>{d.value}</span>
                    </span>
                  )
                ))}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return null;
}

const styles: Record<string, React.CSSProperties> = {
  ...detailStyles,
  episodeHeroThumb: {
    width: "360px",
    borderRadius: "10px",
    boxShadow: "0 6px 30px rgba(0,0,0,0.6)",
    flexShrink: 0,
    objectFit: "cover",
  },
  rating: {
    border: "1px solid var(--text-secondary)",
    padding: "1px 6px",
    borderRadius: "3px",
    fontSize: "0.9rem",
  },
  genreRow: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  genreTag: {
    background: "rgba(255,255,255,0.1)",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    padding: "4px 12px",
    borderRadius: "14px",
  },
  tagline: {
    fontStyle: "italic",
    color: "var(--text-secondary)",
    fontSize: "1rem",
  },
  buttonRow: {
    display: "flex",
    gap: "0.85rem",
    marginTop: "0.75rem",
    alignItems: "center",
  },
  playButton: {
    background: "var(--accent)",
    color: "#000",
    fontSize: "1rem",
    fontWeight: 600,
    padding: "0.6rem 1.5rem",
    borderRadius: "8px",
    width: "fit-content",
  },
  secondaryButton: {
    background: "rgba(255,255,255,0.12)",
    color: "var(--text-primary)",
    fontSize: "0.9rem",
    fontWeight: 500,
    padding: "0.5rem 1.25rem",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.15)",
    cursor: "pointer",
    width: "fit-content",
  },
  fixMatchButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    fontSize: "0.8rem",
    padding: "0.4rem 0.75rem",
    borderRadius: "8px",
    cursor: "pointer",
  },
  showLink: {
    background: "transparent",
    color: "var(--accent)",
    fontSize: "0.9rem",
    padding: 0,
    textAlign: "left",
  },
  summary: {
    color: "var(--text-secondary)",
    fontSize: "0.95rem",
    lineHeight: 1.6,
    maxWidth: "800px",
  },
  ratingBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    background: "rgba(255,255,255,0.1)",
    padding: "4px 12px",
    borderRadius: "4px",
    fontSize: "0.85rem",
  },
  ratingLabel: {
    fontWeight: 600,
    color: "var(--accent)",
    fontSize: "0.85rem",
  },
};
