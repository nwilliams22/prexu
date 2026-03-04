import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import {
  getItemMetadata,
  getItemChildren,
  getImageUrl,
  getRelatedItems,
  getExtras,
} from "../services/plex-library";
import HorizontalRow from "../components/HorizontalRow";
import PosterCard from "../components/PosterCard";
import WatchTogetherButton from "../components/WatchTogetherButton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import type {
  PlexMediaItem,
  PlexMovie,
  PlexShow,
  PlexSeason,
  PlexEpisode,
  PlexTag,
  PlexRole,
  PlexChapter,
} from "../types/library";

function ItemDetail() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const { server } = useAuth();
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const navigate = useNavigate();
  const location = useLocation();
  const [item, setItem] = useState<PlexMediaItem | null>(null);
  const [seasons, setSeasons] = useState<PlexSeason[]>([]);
  const [episodes, setEpisodes] = useState<PlexEpisode[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [related, setRelated] = useState<PlexMediaItem[]>([]);
  const [extras, setExtras] = useState<PlexMediaItem[]>([]);
  const seasonTabsRef = useRef<HTMLDivElement>(null);

  // Fetch item metadata
  useEffect(() => {
    if (!server || !ratingKey) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const metadata = await getItemMetadata<PlexMediaItem>(
          server.uri,
          server.accessToken,
          ratingKey
        );
        if (!cancelled) {
          setItem(metadata);

          // If it's a show, also fetch seasons
          if (metadata.type === "show") {
            const seasonList = await getItemChildren<PlexSeason>(
              server.uri,
              server.accessToken,
              ratingKey
            );
            if (!cancelled) {
              setSeasons(seasonList);
              // Auto-select the season from location state, or default to first
              const stateSeasonKey = (location.state as { selectedSeason?: string })
                ?.selectedSeason;
              const targetSeason = stateSeasonKey
                ? seasonList.find((s) => s.ratingKey === stateSeasonKey)
                : null;
              if (seasonList.length > 0) {
                setSelectedSeason(
                  targetSeason?.ratingKey ?? seasonList[0].ratingKey
                );
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load item"
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, ratingKey]);

  // Update page title when item loads
  useEffect(() => {
    if (item) document.title = `${item.title} - Prexu`;
  }, [item]);

  // Fetch episodes when season changes — keep old episodes visible during load
  useEffect(() => {
    if (!server || !selectedSeason) return;
    let cancelled = false;

    (async () => {
      setIsLoadingEpisodes(true);
      try {
        const epList = await getItemChildren<PlexEpisode>(
          server.uri,
          server.accessToken,
          selectedSeason
        );
        if (!cancelled) {
          // Preserve scroll position when swapping episode list
          const mainEl = seasonTabsRef.current?.closest("main");
          const scrollTop = mainEl?.scrollTop ?? 0;
          setEpisodes(epList);
          requestAnimationFrame(() => {
            if (mainEl) mainEl.scrollTop = scrollTop;
          });
        }
      } catch {
        // Silently fail for episode fetch
      } finally {
        if (!cancelled) setIsLoadingEpisodes(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, selectedSeason]);

  // Fetch related + extras for movies and shows (non-critical)
  useEffect(() => {
    if (!server || !ratingKey || !item) return;
    if (item.type !== "movie" && item.type !== "show") return;
    let cancelled = false;

    Promise.allSettled([
      getRelatedItems(server.uri, server.accessToken, ratingKey),
      getExtras(server.uri, server.accessToken, ratingKey),
    ]).then(([relResult, extResult]) => {
      if (cancelled) return;
      if (relResult.status === "fulfilled") setRelated(relResult.value);
      if (extResult.status === "fulfilled") setExtras(extResult.value);
    });

    return () => {
      cancelled = true;
    };
  }, [server, ratingKey, item]);

  if (!server) return null;

  const artUrl = (path: string) =>
    getImageUrl(server.uri, server.accessToken, path, 1920, 1080);
  const posterUrl = (path: string) =>
    getImageUrl(server.uri, server.accessToken, path, 300, 450);
  const episodeThumbUrl = (path: string) =>
    getImageUrl(server.uri, server.accessToken, path, 400, 225);

  const formatDuration = (ms: number): string => {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const renderTags = (tags: PlexTag[] | undefined): string =>
    tags?.map((t) => t.tag).join(", ") ?? "";

  if (isLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div style={styles.container}>
        <ErrorState message={error ?? "Item not found"} />
      </div>
    );
  }

  // ── Movie Detail ──
  if (item.type === "movie") {
    const movie = item as PlexMovie;
    return (
      <div style={styles.container}>
        {/* Hero */}
        <div style={styles.hero}>
          {movie.art && (
            <img
              src={artUrl(movie.art)}
              alt=""
              loading="lazy"
              style={styles.heroArt}
            />
          )}
          <div style={styles.heroOverlay} />
          <div style={{
            ...styles.heroContent,
            ...(mobile ? { flexDirection: "column", alignItems: "center" } : {}),
          }}>
            <img
              src={posterUrl(movie.thumb)}
              alt={movie.title}
              style={{
                ...styles.heroPoster,
                width: mobile ? "140px" : bp === "large" ? "220px" : "180px",
                ...(mobile ? { alignSelf: "center" } : {}),
              }}
            />
            <div style={{
              ...styles.heroInfo,
              ...(mobile ? { alignItems: "center" } : {}),
            }}>
              <h1 style={{
                ...styles.heroTitle,
                fontSize: mobile ? "1.4rem" : bp === "large" ? "2rem" : "1.75rem",
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
                {movie.rating > 0 && (
                  <span title="Critic rating">★ {movie.rating.toFixed(1)}</span>
                )}
                {movie.audienceRating > 0 && (
                  <span title="Audience rating">♥ {movie.audienceRating.toFixed(1)}</span>
                )}
              </div>
              {movie.Genre && movie.Genre.length > 0 && (
                <div style={styles.genreRow}>
                  {movie.Genre.map((g) => (
                    <span key={g.tag} style={styles.genreTag}>
                      {g.tag}
                    </span>
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
                <button
                  onClick={() => navigate(`/play/${movie.ratingKey}`)}
                  style={styles.playButton}
                >
                  ▶ Play
                </button>
                <WatchTogetherButton
                  ratingKey={movie.ratingKey}
                  title={movie.title}
                  mediaType="movie"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Summary */}
        {movie.summary && (
          <div style={{
            ...styles.section,
            ...(mobile ? { padding: "0.75rem 1rem" } : {}),
          }}>
            <p style={{
              ...styles.summary,
              maxWidth: bp === "large" ? "1000px" : "800px",
            }}>{movie.summary}</p>
          </div>
        )}

        {/* Chapters */}
        {(() => {
          const chapters: PlexChapter[] =
            movie.Media?.[0]?.Part?.[0]?.Chapter ?? [];
          return chapters.length > 0 ? (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Chapters</h3>
              <div style={styles.chapterList}>
                {chapters.map((ch, i) => (
                  <div key={ch.id} style={styles.chapterItem}>
                    <span style={styles.chapterIndex}>{i + 1}</span>
                    <span style={styles.chapterTitle}>{ch.tag}</span>
                    <span style={styles.chapterTime}>
                      {formatDuration(ch.startTimeOffset)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null;
        })()}

        {/* Extras */}
        {extras.length > 0 && (
          <div style={styles.section}>
            <HorizontalRow title="Extras">
              {extras.map((extra) => (
                <PosterCard
                  key={extra.ratingKey}
                  imageUrl={posterUrl(extra.thumb)}
                  title={extra.title}
                  subtitle={(extra as { subtype?: string }).subtype || "Extra"}
                  width={200}
                  aspectRatio={0.56}
                />
              ))}
            </HorizontalRow>
          </div>
        )}

        {/* Cast */}
        {movie.Role && movie.Role.length > 0 && (
          <div style={{
            ...styles.section,
            ...(mobile ? { padding: "0.75rem 1rem" } : {}),
          }}>
            <h3 style={styles.sectionTitle}>Cast</h3>
            <div style={{
              ...styles.castGrid,
              gridTemplateColumns: `repeat(auto-fill, minmax(${mobile ? "140px" : bp === "large" ? "200px" : "180px"}, 1fr))`,
            }}>
              {movie.Role.slice(0, 12).map((role: PlexRole) => (
                <div key={`${role.tag}-${role.role}`} style={styles.castItem}>
                  <span style={styles.castName}>{role.tag}</span>
                  {role.role && (
                    <span style={styles.castRole}>{role.role}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Crew */}
        <div style={styles.section}>
          {movie.Director && movie.Director.length > 0 && (
            <p style={styles.crewLine}>
              <strong>Director:</strong> {renderTags(movie.Director)}
            </p>
          )}
          {movie.Writer && movie.Writer.length > 0 && (
            <p style={styles.crewLine}>
              <strong>Writer:</strong> {renderTags(movie.Writer)}
            </p>
          )}
          {movie.studio && (
            <p style={styles.crewLine}>
              <strong>Studio:</strong> {movie.studio}
            </p>
          )}
        </div>

        {/* Related */}
        {related.length > 0 && (
          <div style={styles.section}>
            <HorizontalRow title="Related">
              {related.map((r) => (
                <PosterCard
                  key={r.ratingKey}
                  imageUrl={posterUrl(r.thumb)}
                  title={r.title}
                  subtitle={
                    (r as { year?: number }).year
                      ? String((r as { year?: number }).year)
                      : ""
                  }
                  onClick={() => navigate(`/item/${r.ratingKey}`)}
                />
              ))}
            </HorizontalRow>
          </div>
        )}
      </div>
    );
  }

  // ── Show Detail ──
  if (item.type === "show") {
    const show = item as PlexShow;
    return (
      <div style={styles.container}>
        {/* Hero */}
        <div style={styles.hero}>
          {show.art && (
            <img
              src={artUrl(show.art)}
              alt=""
              loading="lazy"
              style={styles.heroArt}
            />
          )}
          <div style={styles.heroOverlay} />
          <div style={{
            ...styles.heroContent,
            ...(mobile ? { flexDirection: "column", alignItems: "center" } : {}),
          }}>
            <img
              src={posterUrl(show.thumb)}
              alt={show.title}
              style={{
                ...styles.heroPoster,
                width: mobile ? "140px" : bp === "large" ? "220px" : "180px",
                ...(mobile ? { alignSelf: "center" } : {}),
              }}
            />
            <div style={{
              ...styles.heroInfo,
              ...(mobile ? { alignItems: "center" } : {}),
            }}>
              <h1 style={{
                ...styles.heroTitle,
                fontSize: mobile ? "1.4rem" : bp === "large" ? "2rem" : "1.75rem",
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
                {show.rating > 0 && (
                  <span title="Critic rating">★ {show.rating.toFixed(1)}</span>
                )}
                {show.audienceRating > 0 && (
                  <span title="Audience rating">♥ {show.audienceRating.toFixed(1)}</span>
                )}
              </div>
              {show.Genre && show.Genre.length > 0 && (
                <div style={styles.genreRow}>
                  {show.Genre.map((g) => (
                    <span key={g.tag} style={styles.genreTag}>
                      {g.tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Summary */}
        {show.summary && (
          <div style={{
            ...styles.section,
            ...(mobile ? { padding: "0.75rem 1rem" } : {}),
          }}>
            <p style={{
              ...styles.summary,
              maxWidth: bp === "large" ? "1000px" : "800px",
            }}>{show.summary}</p>
          </div>
        )}

        {/* Extras */}
        {extras.length > 0 && (
          <div style={styles.section}>
            <HorizontalRow title="Extras">
              {extras.map((extra) => (
                <PosterCard
                  key={extra.ratingKey}
                  imageUrl={posterUrl(extra.thumb)}
                  title={extra.title}
                  subtitle={(extra as { subtype?: string }).subtype || "Extra"}
                  width={200}
                  aspectRatio={0.56}
                />
              ))}
            </HorizontalRow>
          </div>
        )}

        {/* Season selector + Episode list */}
        <div style={styles.section}>
          <div ref={seasonTabsRef} style={styles.seasonTabs}>
            {seasons.map((season) => (
              <button
                key={season.ratingKey}
                onClick={() => {
                  if (season.ratingKey === selectedSeason) return;
                  // Capture scroll position of the main container before state update
                  const mainEl = seasonTabsRef.current?.closest("main");
                  const scrollTop = mainEl?.scrollTop ?? 0;
                  setSelectedSeason(season.ratingKey);
                  // Restore scroll position after React re-render
                  requestAnimationFrame(() => {
                    if (mainEl) mainEl.scrollTop = scrollTop;
                  });
                }}
                style={{
                  ...styles.seasonTab,
                  ...(selectedSeason === season.ratingKey
                    ? styles.seasonTabActive
                    : {}),
                }}
              >
                {season.title}
              </button>
            ))}
          </div>

          <div style={{
            ...styles.episodeList,
            opacity: isLoadingEpisodes && episodes.length > 0 ? 0.5 : 1,
            transition: "opacity 0.15s ease",
          }}>
            {/* Loading spinner only when no episodes to show yet */}
            {isLoadingEpisodes && episodes.length === 0 && (
              <div style={styles.episodeLoading}>
                <div className="loading-spinner" />
              </div>
            )}
            {!isLoadingEpisodes && episodes.length === 0 && selectedSeason && (
              <EmptyState
                icon={
                  <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <rect x={2} y={2} width={20} height={20} rx={2.18} ry={2.18} />
                    <line x1={7} y1={2} x2={7} y2={22} />
                    <line x1={17} y1={2} x2={17} y2={22} />
                    <line x1={2} y1={12} x2={22} y2={12} />
                    <line x1={2} y1={7} x2={7} y2={7} />
                    <line x1={2} y1={17} x2={7} y2={17} />
                    <line x1={17} y1={17} x2={22} y2={17} />
                    <line x1={17} y1={7} x2={22} y2={7} />
                  </svg>
                }
                title="No episodes in this season"
              />
            )}
            {episodes.map((ep) => (
              <button
                key={ep.ratingKey}
                onClick={() => navigate(`/item/${ep.ratingKey}`)}
                style={{
                  ...styles.episodeItem,
                  ...(mobile ? { flexDirection: "column" } : {}),
                }}
              >
                <img
                  src={episodeThumbUrl(ep.thumb)}
                  alt={ep.title}
                  style={{
                    ...styles.episodeThumb,
                    ...(mobile ? { width: "100%", height: "auto", aspectRatio: "16/9" } : {}),
                  }}
                  loading="lazy"
                />
                <div style={styles.episodeInfo}>
                  <span style={styles.episodeNumber}>
                    E{String(ep.index).padStart(2, "0")}
                  </span>
                  <span style={styles.episodeTitle}>{ep.title}</span>
                  <div style={styles.episodeMeta}>
                    {ep.originallyAvailableAt && (
                      <span>{ep.originallyAvailableAt}</span>
                    )}
                    {ep.duration && (
                      <span>{formatDuration(ep.duration)}</span>
                    )}
                  </div>
                  {ep.summary && (
                    <p style={styles.episodeSummary}>{ep.summary}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Related */}
        {related.length > 0 && (
          <div style={styles.section}>
            <HorizontalRow title="Related">
              {related.map((r) => (
                <PosterCard
                  key={r.ratingKey}
                  imageUrl={posterUrl(r.thumb)}
                  title={r.title}
                  subtitle={
                    (r as { year?: number }).year
                      ? String((r as { year?: number }).year)
                      : ""
                  }
                  onClick={() => navigate(`/item/${r.ratingKey}`)}
                />
              ))}
            </HorizontalRow>
          </div>
        )}
      </div>
    );
  }

  // ── Episode Detail ──
  if (item.type === "episode") {
    const ep = item as PlexEpisode;
    return (
      <div style={styles.container}>
        <div style={styles.hero}>
          {(ep.grandparentArt || ep.art) && (
            <img
              src={artUrl(ep.grandparentArt || ep.art)}
              alt=""
              loading="lazy"
              style={styles.heroArt}
            />
          )}
          <div style={styles.heroOverlay} />
          <div style={{
            ...styles.heroContent,
            ...(mobile ? { flexDirection: "column", alignItems: "center" } : {}),
          }}>
            <img
              src={episodeThumbUrl(ep.thumb)}
              alt={ep.title}
              style={{
                ...styles.episodeHeroThumb,
                ...(mobile ? { width: "100%", maxWidth: "280px", alignSelf: "center" } : {}),
              }}
            />
            <div style={{
              ...styles.heroInfo,
              ...(mobile ? { alignItems: "center" } : {}),
            }}>
              <button
                onClick={() => navigate(`/item/${ep.grandparentRatingKey}`)}
                style={styles.showLink}
              >
                {ep.grandparentTitle}
              </button>
              <h1 style={{
                ...styles.heroTitle,
                fontSize: mobile ? "1.4rem" : bp === "large" ? "2rem" : "1.75rem",
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
              </div>
              <div style={{
                ...styles.buttonRow,
                ...(mobile ? { justifyContent: "center" } : {}),
              }}>
                <button
                  onClick={() => navigate(`/play/${ep.ratingKey}`)}
                  style={styles.playButton}
                >
                  ▶ Play
                </button>
                <WatchTogetherButton
                  ratingKey={ep.ratingKey}
                  title={`${ep.grandparentTitle} — ${ep.title}`}
                  mediaType="episode"
                />
              </div>
            </div>
          </div>
        </div>

        {ep.summary && (
          <div style={{
            ...styles.section,
            ...(mobile ? { padding: "0.75rem 1rem" } : {}),
          }}>
            <p style={{
              ...styles.summary,
              maxWidth: bp === "large" ? "1000px" : "800px",
            }}>{ep.summary}</p>
          </div>
        )}
      </div>
    );
  }

  // ── Season — redirect to parent show with this season pre-selected ──
  if (item.type === "season") {
    const season = item as PlexSeason;
    // Navigate to the parent show and pass the season key as state
    navigate(`/item/${season.parentRatingKey}`, {
      replace: true,
      state: { selectedSeason: season.ratingKey },
    });
    return null;
  }

  // ── Fallback for other types ──
  return (
    <div style={styles.container}>
      <h2>{item.title}</h2>
      <p style={{ color: "var(--text-secondary)" }}>
        Detail view for type "{item.type}" is not yet supported.
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    paddingBottom: "2rem",
  },
  loadingContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4rem",
  },
  // Hero
  hero: {
    position: "relative",
    minHeight: "320px",
    display: "flex",
    alignItems: "flex-end",
    overflow: "hidden",
  },
  heroArt: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center top",
    filter: "blur(2px) brightness(0.4)",
  },
  heroOverlay: {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(to top, var(--bg-primary) 0%, transparent 60%)",
  },
  heroContent: {
    position: "relative",
    display: "flex",
    gap: "1.5rem",
    padding: "2rem 1.5rem 1.5rem",
    width: "100%",
    zIndex: 1,
  },
  heroPoster: {
    width: "180px",
    borderRadius: "8px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    flexShrink: 0,
    objectFit: "cover",
  },
  episodeHeroThumb: {
    width: "280px",
    borderRadius: "8px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    flexShrink: 0,
    objectFit: "cover",
  },
  heroInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    justifyContent: "flex-end",
  },
  heroTitle: {
    fontSize: "1.75rem",
    fontWeight: 700,
    lineHeight: 1.2,
  },
  metaRow: {
    display: "flex",
    gap: "0.75rem",
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    flexWrap: "wrap",
  },
  rating: {
    border: "1px solid var(--text-secondary)",
    padding: "0 4px",
    borderRadius: "3px",
    fontSize: "0.8rem",
  },
  genreRow: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  genreTag: {
    background: "rgba(255,255,255,0.1)",
    color: "var(--text-secondary)",
    fontSize: "0.75rem",
    padding: "3px 8px",
    borderRadius: "12px",
  },
  tagline: {
    fontStyle: "italic",
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
  },
  buttonRow: {
    display: "flex",
    gap: "0.75rem",
    marginTop: "0.5rem",
    alignItems: "center",
  },
  playButton: {
    background: "var(--accent)",
    color: "#000",
    fontSize: "0.9rem",
    fontWeight: 600,
    padding: "0.5rem 1.25rem",
    borderRadius: "8px",
    width: "fit-content",
  },
  showLink: {
    background: "transparent",
    color: "var(--accent)",
    fontSize: "0.9rem",
    padding: 0,
    textAlign: "left",
  },

  // Sections
  section: {
    padding: "1rem 1.5rem",
  },
  sectionTitle: {
    fontSize: "1.15rem",
    fontWeight: 600,
    marginBottom: "0.75rem",
  },
  summary: {
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    lineHeight: 1.6,
    maxWidth: "800px",
  },

  // Cast
  castGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: "0.5rem",
  },
  castItem: {
    display: "flex",
    flexDirection: "column",
    padding: "0.4rem 0",
  },
  castName: {
    fontSize: "0.85rem",
    fontWeight: 500,
  },
  castRole: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  crewLine: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    marginBottom: "0.3rem",
  },

  // Chapters
  chapterList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  chapterItem: {
    display: "flex",
    gap: "0.75rem",
    padding: "0.4rem 0",
    alignItems: "center",
    borderBottom: "1px solid var(--border)",
  },
  chapterIndex: {
    color: "var(--text-secondary)",
    fontSize: "0.8rem",
    width: "24px",
    textAlign: "right",
    flexShrink: 0,
  },
  chapterTitle: {
    fontSize: "0.85rem",
    flex: 1,
  },
  chapterTime: {
    color: "var(--text-secondary)",
    fontSize: "0.8rem",
    flexShrink: 0,
  },

  // Seasons
  seasonTabs: {
    display: "flex",
    gap: "0.25rem",
    overflowX: "auto",
    marginBottom: "1rem",
    paddingBottom: "4px",
  },
  seasonTab: {
    background: "var(--bg-card)",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    padding: "0.5rem 1rem",
    borderRadius: "6px",
    whiteSpace: "nowrap",
    border: "1px solid var(--border)",
    outline: "none",
    flexShrink: 0,
  },
  seasonTabActive: {
    background: "var(--accent)",
    color: "#000",
    borderColor: "var(--accent)",
    fontWeight: 600,
  },

  // Episodes
  episodeLoading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
  },
  episodeList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  episodeItem: {
    display: "flex",
    gap: "1rem",
    padding: "0.75rem",
    background: "var(--bg-card)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    textAlign: "left",
    color: "var(--text-primary)",
    width: "100%",
    transition: "border-color 0.15s",
  },
  episodeThumb: {
    width: "180px",
    height: "100px",
    borderRadius: "6px",
    objectFit: "cover",
    flexShrink: 0,
    background: "var(--bg-secondary)",
  },
  episodeInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
    overflow: "hidden",
    flex: 1,
  },
  episodeNumber: {
    fontSize: "0.75rem",
    color: "var(--accent)",
    fontWeight: 600,
  },
  episodeTitle: {
    fontSize: "0.95rem",
    fontWeight: 500,
  },
  episodeMeta: {
    display: "flex",
    gap: "0.75rem",
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
  },
  episodeSummary: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    lineHeight: 1.4,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as never,
    marginTop: "0.25rem",
  },
};

export default ItemDetail;
