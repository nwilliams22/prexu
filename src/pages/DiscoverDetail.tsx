/**
 * DiscoverDetail — detail page for media NOT on the server.
 * Shows TMDB data with a "Request This Content" button instead of Play.
 * Route: /discover/:mediaType/:tmdbId (e.g., /discover/movie/123 or /discover/tv/456)
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useBreakpoint, isMobile, isTabletOrBelow } from "../hooks/useBreakpoint";
import { getTmdbApiKey } from "../services/storage";
import {
  getTmdbMovieDetail,
  getTmdbTvDetail,
  getTmdbImageUrl,
  type TmdbMovieDetail,
  type TmdbTvDetail,
} from "../services/tmdb";
import HorizontalRow from "../components/HorizontalRow";

/** Format runtime in hours and minutes */
function formatRuntime(minutes: number | null): string {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function DiscoverDetail() {
  const { mediaType, tmdbId } = useParams<{
    mediaType: string;
    tmdbId: string;
  }>();
  const navigate = useNavigate();
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const tablet = isTabletOrBelow(bp) && !mobile;

  const [movieDetail, setMovieDetail] = useState<TmdbMovieDetail | null>(null);
  const [tvDetail, setTvDetail] = useState<TmdbTvDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredCast, setHoveredCast] = useState<string | null>(null);

  const isMovie = mediaType === "movie";
  const detail = isMovie ? movieDetail : tvDetail;

  useEffect(() => {
    if (!tmdbId || !mediaType) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const apiKey = await getTmdbApiKey();
        if (!apiKey) {
          setError("TMDB API key not configured.");
          return;
        }

        const id = parseInt(tmdbId, 10);
        if (isNaN(id)) {
          setError("Invalid media ID.");
          return;
        }

        if (mediaType === "movie") {
          const result = await getTmdbMovieDetail(apiKey, id);
          if (!cancelled) {
            if (result) {
              setMovieDetail(result);
              document.title = `${result.title} - Prexu`;
            } else {
              setError("Movie not found.");
            }
          }
        } else {
          const result = await getTmdbTvDetail(apiKey, id);
          if (!cancelled) {
            if (result) {
              setTvDetail(result);
              document.title = `${result.name} - Prexu`;
            } else {
              setError("TV show not found.");
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load details"
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tmdbId, mediaType]);

  if (isLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div style={styles.errorContainer}>
        <p style={{ color: "var(--error)" }}>{error ?? "Not found"}</p>
      </div>
    );
  }

  // Extract common fields
  const title = isMovie
    ? (detail as TmdbMovieDetail).title
    : (detail as TmdbTvDetail).name;
  const overview = detail.overview;
  const tagline = detail.tagline;
  const genres = detail.genres.map((g) => g.name).join(", ");
  const voteAverage = detail.vote_average;
  const posterUrl = getTmdbImageUrl(detail.poster_path, "w500");
  const backdropUrl = getTmdbImageUrl(detail.backdrop_path, "original");
  const year = isMovie
    ? (detail as TmdbMovieDetail).release_date?.slice(0, 4)
    : (detail as TmdbTvDetail).first_air_date?.slice(0, 4);
  const runtime = isMovie
    ? formatRuntime((detail as TmdbMovieDetail).runtime)
    : null;
  const seasons = !isMovie
    ? (detail as TmdbTvDetail).number_of_seasons
    : null;
  const episodes = !isMovie
    ? (detail as TmdbTvDetail).number_of_episodes
    : null;
  const status = detail.status;
  const cast = detail.credits?.cast?.slice(0, 20) ?? [];
  const directors =
    detail.credits?.crew?.filter((c) => c.job === "Director") ?? [];

  const handleRequest = () => {
    navigate(
      `/requests?q=${encodeURIComponent(title)}&type=${mediaType === "movie" ? "movie" : "tv"}`
    );
  };

  const heroHeight = mobile ? 400 : tablet ? 550 : 650;

  return (
    <div style={styles.container}>
      {/* Hero backdrop */}
      <div
        style={{
          ...styles.heroBackdrop,
          backgroundImage: backdropUrl
            ? `linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.5) 60%, var(--bg-primary) 100%), url(${backdropUrl})`
            : posterUrl
              ? `linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.5) 60%, var(--bg-primary) 100%), url(${posterUrl})`
              : undefined,
          height: heroHeight,
          backgroundSize: "cover",
          backgroundPosition: "center top",
        }}
      >
        <div
          style={{
            ...styles.heroContent,
            flexDirection: mobile ? "column" : "row",
            alignItems: mobile ? "center" : "flex-end",
            padding: mobile ? "1.5rem" : "2.5rem 3rem",
          }}
        >
          {/* Poster */}
          {posterUrl && (
            <img
              src={posterUrl}
              alt={title}
              style={{
                ...styles.poster,
                width: mobile ? 180 : tablet ? 240 : 300,
                height: mobile ? 270 : tablet ? 360 : 450,
              }}
            />
          )}

          {/* Info */}
          <div style={styles.heroInfo}>
            <h1 style={{ ...styles.title, fontSize: mobile ? "2rem" : tablet ? "2.5rem" : "3rem" }}>
              {title}
              {year && (
                <span style={styles.year}> ({year})</span>
              )}
            </h1>

            {tagline && <p style={styles.tagline}>{tagline}</p>}

            <div style={styles.metaRow}>
              {genres && <span>{genres}</span>}
              {runtime && <span> · {runtime}</span>}
              {seasons !== null && (
                <span>
                  {" "}
                  · {seasons} season{seasons !== 1 ? "s" : ""}
                </span>
              )}
              {episodes !== null && (
                <span>
                  {" "}
                  · {episodes} episode{episodes !== 1 ? "s" : ""}
                </span>
              )}
              {status && <span> · {status}</span>}
            </div>

            {voteAverage > 0 && (
              <div style={styles.ratingRow}>
                <span style={styles.ratingBadge}>
                  ★ {voteAverage.toFixed(1)}
                </span>
                <span style={styles.ratingLabel}>TMDB</span>
              </div>
            )}

            {/* Directors inline */}
            {directors.length > 0 && (
              <p style={styles.directorsHero}>
                Directed by {directors.map((d) => d.name).join(", ")}
              </p>
            )}

            {/* Request button */}
            <button style={styles.requestButton} onClick={handleRequest}>
              <svg
                width={22}
                height={22}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: "0.5rem", verticalAlign: "middle" }}
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Request This Content
            </button>
          </div>
        </div>
      </div>

      {/* Body content */}
      <div style={styles.body}>
        {/* Synopsis */}
        {overview && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Synopsis</h2>
            <p style={styles.overview}>{overview}</p>
          </div>
        )}

        {/* Cast — horizontal scroll row like ItemDetail */}
        {cast.length > 0 && (
          <div style={styles.section}>
            <HorizontalRow title="Cast">
              {cast.map((person) => {
                const imgUrl = person.profile_path
                  ? getTmdbImageUrl(person.profile_path, "w185")
                  : null;
                const key = `${person.id}-${person.character}`;
                const isHovered = hoveredCast === key;
                return (
                  <div
                    key={key}
                    style={styles.castCard}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      navigate(
                        `/actor/${encodeURIComponent(person.name)}`
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(
                          `/actor/${encodeURIComponent(person.name)}`
                        );
                      }
                    }}
                    onMouseEnter={() => setHoveredCast(key)}
                    onMouseLeave={() => setHoveredCast(null)}
                    onFocus={() => setHoveredCast(key)}
                    onBlur={() => setHoveredCast(null)}
                  >
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={person.name}
                        loading="lazy"
                        style={{
                          ...styles.castPhoto,
                          border: isHovered ? "3px solid var(--accent)" : "3px solid transparent",
                          transform: isHovered ? "scale(1.05)" : "scale(1)",
                          transition: "border-color 0.2s ease, transform 0.2s ease",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          ...styles.castPhotoFallback,
                          border: isHovered ? "3px solid var(--accent)" : "1px solid var(--border)",
                          transform: isHovered ? "scale(1.05)" : "scale(1)",
                          transition: "border-color 0.2s ease, transform 0.2s ease",
                        }}
                      >
                        <span style={styles.castInitials}>
                          {person.name
                            .split(/\s+/)
                            .map((p) => p[0])
                            .join("")
                            .toUpperCase()
                            .slice(0, 2)}
                        </span>
                      </div>
                    )}
                    <span style={styles.castName}>{person.name}</span>
                    {person.character && (
                      <span style={styles.castRole}>{person.character}</span>
                    )}
                  </div>
                );
              })}
            </HorizontalRow>
          </div>
        )}

        {/* Not on server notice */}
        <div style={styles.noticeBox}>
          <svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-secondary)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, marginTop: 2 }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p style={styles.noticeText}>
            This {isMovie ? "movie" : "TV show"} is not on any of the servers
            you have access to. You can request it to be added.
          </p>
        </div>
      </div>
    </div>
  );
}

export default DiscoverDetail;

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: "100%",
  },
  heroBackdrop: {
    position: "relative",
    display: "flex",
    alignItems: "flex-end",
    backgroundRepeat: "no-repeat",
  },
  heroContent: {
    display: "flex",
    gap: "2rem",
    width: "100%",
  },
  poster: {
    borderRadius: "10px",
    objectFit: "cover",
    boxShadow: "0 6px 30px rgba(0,0,0,0.6)",
    flexShrink: 0,
  },
  heroInfo: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontWeight: 700,
    margin: 0,
    color: "#fff",
    lineHeight: 1.2,
    textShadow: "0 2px 10px rgba(0,0,0,0.7)",
  },
  year: {
    fontWeight: 400,
    opacity: 0.8,
  },
  tagline: {
    fontSize: "1.15rem",
    color: "rgba(255,255,255,0.7)",
    fontStyle: "italic",
    margin: "0.5rem 0 0",
    textShadow: "0 1px 4px rgba(0,0,0,0.5)",
  },
  metaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.25rem",
    fontSize: "1.05rem",
    color: "rgba(255,255,255,0.8)",
    margin: "0.75rem 0",
    textShadow: "0 1px 4px rgba(0,0,0,0.5)",
  },
  ratingRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    margin: "0.5rem 0",
  },
  ratingBadge: {
    background: "rgba(255,255,255,0.15)",
    color: "#fff",
    padding: "0.3rem 0.75rem",
    borderRadius: "6px",
    fontSize: "1rem",
    fontWeight: 600,
    backdropFilter: "blur(8px)",
  },
  ratingLabel: {
    fontSize: "0.85rem",
    color: "rgba(255,255,255,0.6)",
    fontWeight: 500,
  },
  directorsHero: {
    fontSize: "1rem",
    color: "rgba(255,255,255,0.7)",
    margin: "0.5rem 0 0",
    textShadow: "0 1px 4px rgba(0,0,0,0.5)",
  },
  requestButton: {
    display: "inline-flex",
    alignItems: "center",
    marginTop: "1.25rem",
    padding: "0.85rem 2rem",
    fontSize: "1.15rem",
    fontWeight: 600,
    borderRadius: "10px",
    border: "none",
    background: "var(--accent)",
    color: "#000",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
  },
  body: {
    padding: "2rem 3rem",
  },
  section: {
    marginBottom: "2.5rem",
  },
  sectionTitle: {
    fontSize: "1.5rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: "0 0 1rem 0",
  },
  overview: {
    fontSize: "1.1rem",
    color: "var(--text-primary)",
    lineHeight: 1.7,
    maxWidth: "800px",
    opacity: 0.9,
    margin: 0,
  },
  // Cast — matching ItemDetail sizes
  castCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "200px",
    cursor: "pointer",
    flexShrink: 0,
    gap: "0.5rem",
  },
  castPhoto: {
    width: "180px",
    height: "180px",
    borderRadius: "50%",
    objectFit: "cover",
    background: "var(--bg-secondary)",
  },
  castPhotoFallback: {
    width: "180px",
    height: "180px",
    borderRadius: "50%",
    background: "var(--bg-card)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  castInitials: {
    fontSize: "2.2rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
  },
  castName: {
    fontSize: "1rem",
    fontWeight: 500,
    textAlign: "center",
    lineHeight: 1.3,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as never,
    maxWidth: "100%",
  },
  castRole: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    textAlign: "center",
    lineHeight: 1.3,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as never,
    maxWidth: "100%",
  },
  noticeBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.75rem",
    padding: "1.25rem",
    background: "var(--bg-card)",
    borderRadius: "10px",
    border: "1px solid var(--border)",
    marginTop: "1rem",
  },
  noticeText: {
    fontSize: "1rem",
    color: "var(--text-secondary)",
    margin: 0,
    lineHeight: 1.5,
  },
  loadingContainer: {
    display: "flex",
    justifyContent: "center",
    padding: "4rem 0",
  },
  errorContainer: {
    display: "flex",
    justifyContent: "center",
    padding: "3rem 0",
  },
};
