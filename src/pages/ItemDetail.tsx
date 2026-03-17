import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePreferences } from "../hooks/usePreferences";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import {
  getItemMetadata,
  getItemChildren,
  getImageUrl,
  getRelatedItems,
  getExtras,
  getMediaByActor,
} from "../services/plex-library";
import HorizontalRow from "../components/HorizontalRow";
import PosterCard from "../components/PosterCard";
import WatchTogetherButton from "../components/WatchTogetherButton";
import WatchedToggleButton from "../components/WatchedToggleButton";
import FixMatchDialog from "../components/FixMatchDialog";
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
  PlexRating,
} from "../types/library";
import { formatResumeTime, decodeHtmlEntities } from "../utils/media-helpers";
import { detailStyles } from "../utils/detail-styles";
import { getInitials } from "../utils/text-format";
import {
  buildRatingBadges,
  TomatoIcon,
  PopcornIcon,
  ImdbIcon,
  TmdbIcon,
} from "../utils/rating-badges";

function ItemDetail() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const { server, activeUser } = useAuth();
  const { preferences } = usePreferences();
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const navigate = useNavigate();
  const [item, setItem] = useState<PlexMediaItem | null>(null);
  const [seasons, setSeasons] = useState<PlexSeason[]>([]);
  const [episodes, setEpisodes] = useState<PlexEpisode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [parentShow, setParentShow] = useState<PlexShow | null>(null);
  const [siblingSeasons, setSiblingSeasons] = useState<PlexSeason[]>([]);
  const [siblingEpisodes, setSiblingEpisodes] = useState<PlexEpisode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [related, setRelated] = useState<PlexMediaItem[]>([]);
  const [extras, setExtras] = useState<PlexMediaItem[]>([]);
  const [hoveredCast, setHoveredCast] = useState<string | null>(null);
  const [moreWithActors, setMoreWithActors] = useState<
    { name: string; items: PlexMediaItem[] }[]
  >([]);
  const [showFixMatch, setShowFixMatch] = useState(false);
  const [seasonFading, setSeasonFading] = useState(false);
  const [failedCastImages, setFailedCastImages] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshItem = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleCastImageError = useCallback((key: string) => {
    setFailedCastImages((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  /** Switch season inline with crossfade — avoids full page reload */
  const switchSeason = useCallback(async (targetSeason: PlexSeason) => {
    if (!server) return;
    setSeasonFading(true);
    try {
      const [seasonMeta, epList] = await Promise.all([
        getItemMetadata<PlexSeason>(server.uri, server.accessToken, targetSeason.ratingKey),
        getItemChildren<PlexEpisode>(server.uri, server.accessToken, targetSeason.ratingKey),
      ]);
      // Brief delay so the fade-out is visible
      await new Promise((r) => setTimeout(r, 150));
      setItem(seasonMeta);
      setEpisodes(epList);
      // Update URL without full navigation
      window.history.replaceState(null, "", `/item/${targetSeason.ratingKey}`);
    } catch {
      // Fallback to full navigation if inline switch fails
      navigate(`/item/${targetSeason.ratingKey}`);
    } finally {
      setSeasonFading(false);
    }
  }, [server, navigate]);

  const isAdmin = activeUser?.isAdmin ?? false;

  // Fetch item metadata
  useEffect(() => {
    if (!server || !ratingKey) return;
    let cancelled = false;

    // Reset ALL state for clean load — prevents stale data from previous detail pages
    setItem(null);
    setIsLoading(true);
    // Scroll to top when navigating between detail pages
    const mainEl = document.querySelector("main");
    if (mainEl) mainEl.scrollTop = 0;
    else window.scrollTo(0, 0);
    setError(null);
    setSeasons([]);
    setEpisodes([]);
    setSiblingEpisodes([]);
    setParentShow(null);
    setSiblingSeasons([]);
    setRelated([]);
    setExtras([]);
    setMoreWithActors([]);
    setFailedCastImages(new Set());

    (async () => {
      try {
        const metadata = await getItemMetadata<PlexMediaItem>(
          server.uri,
          server.accessToken,
          ratingKey
        );
        if (!cancelled) {
          setItem(metadata);

          // If it's a show, fetch seasons for the poster grid
          if (metadata.type === "show") {
            const seasonList = await getItemChildren<PlexSeason>(
              server.uri,
              server.accessToken,
              ratingKey
            );
            if (!cancelled) {
              // Skip to the only season if preference is enabled
              if (seasonList.length === 1 && preferences.appearance.skipSingleSeason) {
                navigate(`/item/${seasonList[0].ratingKey}`, { replace: true });
                return;
              }
              setSeasons(seasonList);
            }
          }

          // If it's a season, fetch episodes and parent show info
          if (metadata.type === "season") {
            const season = metadata as PlexSeason;
            const [epList, showMeta, siblingList] = await Promise.all([
              getItemChildren<PlexEpisode>(
                server.uri,
                server.accessToken,
                ratingKey
              ),
              getItemMetadata<PlexShow>(
                server.uri,
                server.accessToken,
                season.parentRatingKey
              ),
              getItemChildren<PlexSeason>(
                server.uri,
                server.accessToken,
                season.parentRatingKey
              ),
            ]);
            if (!cancelled) {
              setEpisodes(epList);
              setParentShow(showMeta);
              setSiblingSeasons(siblingList);
            }
          }

          // If it's an episode, fetch sibling episodes from the same season
          if (metadata.type === "episode") {
            const episode = metadata as PlexEpisode;
            const siblings = await getItemChildren<PlexEpisode>(
              server.uri,
              server.accessToken,
              episode.parentRatingKey
            );
            if (!cancelled) {
              setSiblingEpisodes(siblings);
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
  }, [server, ratingKey, refreshKey]);

  // Update page title when item loads
  useEffect(() => {
    if (item) document.title = `${item.title} - Prexu`;
  }, [item]);

  // Fetch related + extras + "more with actor" for movies, shows, and episodes (non-critical)
  useEffect(() => {
    if (!server || !ratingKey || !item) return;
    if (item.type !== "movie" && item.type !== "show" && item.type !== "episode") return;
    let cancelled = false;

    // Get top 2 billed actors for "More with" rows
    const roles: PlexRole[] =
      (item as PlexMovie | PlexShow | PlexEpisode).Role ?? [];
    const leadActors = roles.slice(0, 2).map((r) => r.tag);

    const actorSearches = leadActors.map((name) =>
      getMediaByActor(server.uri, server.accessToken, name)
        .then((allItems) => {
          // Filter out current item
          const items = allItems.filter((m) => m.ratingKey !== ratingKey);
          return { name, items };
        })
        .catch(() => ({ name, items: [] as PlexMediaItem[] }))
    );

    Promise.allSettled([
      getRelatedItems(server.uri, server.accessToken, ratingKey),
      getExtras(server.uri, server.accessToken, ratingKey),
      Promise.all(actorSearches),
    ]).then(([relResult, extResult, actorResult]) => {
      if (cancelled) return;
      if (relResult.status === "fulfilled") setRelated(relResult.value);
      if (extResult.status === "fulfilled") setExtras(extResult.value);
      if (actorResult.status === "fulfilled") {
        setMoreWithActors(
          actorResult.value.filter((a) => a.items.length > 0)
        );
      }
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
  const actorThumbUrl = (path: string) =>
    getImageUrl(server.uri, server.accessToken, path, 440, 440);

  const formatDuration = (ms: number): string => {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  /** Render rating badges with source icons */
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

  /** Render Cast & Crew section with circular photos */
  const renderCastCrew = (
    roles: PlexRole[] | undefined,
    directors: PlexTag[] | undefined,
    writers: PlexTag[] | undefined,
    studio?: string
  ) => {
    const castItems = (roles ?? []).map((r) => ({
      key: `cast-${r.tag}-${r.role}`,
      name: r.tag,
      subtitle: r.role,
      thumb: r.thumb,
    }));
    const crewItems: typeof castItems = [];
    (directors ?? []).forEach((d) =>
      crewItems.push({ key: `dir-${d.tag}`, name: d.tag, subtitle: "Director", thumb: undefined })
    );
    (writers ?? []).forEach((w) =>
      crewItems.push({ key: `wri-${w.tag}`, name: w.tag, subtitle: "Writer", thumb: undefined })
    );
    const allItems = [...castItems, ...crewItems];
    if (allItems.length === 0 && !studio) return null;

    return (
      <div style={styles.section}>
        <HorizontalRow title="Cast & Crew">
          {allItems.map((person) => {
            const isHovered = hoveredCast === person.key;
            return (
              <div
                key={person.key}
                role="button"
                tabIndex={0}
                style={{ ...styles.castCard, cursor: "pointer" }}
                onClick={() =>
                  navigate(`/actor/${encodeURIComponent(person.name)}`, {
                    state: { thumb: person.thumb },
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/actor/${encodeURIComponent(person.name)}`, {
                      state: { thumb: person.thumb },
                    });
                  }
                }}
                onMouseEnter={() => setHoveredCast(person.key)}
                onMouseLeave={() => setHoveredCast(null)}
                onFocus={() => setHoveredCast(person.key)}
                onBlur={() => setHoveredCast(null)}
              >
                {person.thumb && !failedCastImages.has(person.key) ? (
                  <img
                    src={actorThumbUrl(person.thumb)}
                    alt={person.name}
                    loading="lazy"
                    onError={() => handleCastImageError(person.key)}
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
                    <span style={styles.castInitials}>{getInitials(person.name)}</span>
                  </div>
                )}
                <span style={styles.castCardName}>{person.name}</span>
                {person.subtitle && (
                  <span style={styles.castCardRole}>{person.subtitle}</span>
                )}
              </div>
            );
          })}
        </HorizontalRow>
        {studio && (
          <p style={{ ...styles.crewLine, marginTop: "0.5rem" }}>
            <strong>Studio:</strong> {studio}
          </p>
        )}
      </div>
    );
  };

  /** Render "More with [Actor]" rows */
  const renderMoreWithActors = () => {
    if (moreWithActors.length === 0) return null;
    return moreWithActors.map((actor) => (
      <div key={actor.name} style={styles.section}>
        <HorizontalRow title={`More with ${actor.name}`}>
          {actor.items.map((m) => {
            const meta = m as unknown as { childCount?: number; year?: number };
            let subtitle = "";
            if (meta.childCount) {
              subtitle = `${meta.childCount} season${meta.childCount !== 1 ? "s" : ""}`;
            } else if (meta.year) {
              subtitle = String(meta.year);
            }
            return (
              <PosterCard
                key={m.ratingKey}
                ratingKey={m.ratingKey}
                imageUrl={posterUrl(m.thumb)}
                title={m.title}
                subtitle={subtitle}
                width={230}
                onClick={() => navigate(`/item/${m.ratingKey}`)}
              />
            );
          })}
        </HorizontalRow>
      </div>
    ));
  };

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
        {/* Full-page background art (falls back to blurred poster) */}
        <img
          src={movie.art ? artUrl(movie.art) : posterUrl(movie.thumb)}
          alt=""
          loading="lazy"
          style={movie.art ? styles.pageBgArt : styles.pageBgArtFallback}
        />
        <div style={styles.pageBgOverlay} />

        {/* Media info */}
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
                {movie.viewOffset && movie.viewOffset > 0 ? (
                  <>
                    <button
                      onClick={() => navigate(`/play/${movie.ratingKey}`)}
                      style={styles.playButton}
                    >
                      ▶ Resume from {formatResumeTime(movie.viewOffset)}
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
                    ▶ Play
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
                    onClick={() => setShowFixMatch(true)}
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
              {/* Synopsis */}
              {movie.summary && (
                <p style={{
                  ...styles.summary,
                  maxWidth: bp === "large" ? "1000px" : "800px",
                  marginTop: "0.25rem",
                }}>{decodeHtmlEntities(movie.summary)}</p>
              )}
            </div>
          </div>

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

        {/* Cast & Crew */}
        {renderCastCrew(movie.Role, movie.Director, movie.Writer, movie.studio)}

        {/* Extras */}
        {extras.length > 0 && (
          <div style={styles.section}>
            <HorizontalRow title="Extras">
              {extras.map((extra) => (
                <PosterCard
                  key={extra.ratingKey}
                  ratingKey={extra.ratingKey}
                  imageUrl={posterUrl(extra.thumb)}
                  title={extra.title}
                  subtitle={(extra as { subtype?: string }).subtype || "Extra"}
                  width={360}
                  aspectRatio={0.56}
                  onClick={() => navigate(`/play/${extra.ratingKey}`)}
                />
              ))}
            </HorizontalRow>
          </div>
        )}

        {/* Related */}
        {related.length > 0 && (
          <div style={styles.section}>
            <HorizontalRow title="Related">
              {related.map((r) => {
                const asShow = r as { childCount?: number; leafCount?: number; year?: number };
                let subtitle = "";
                if (asShow.childCount) {
                  subtitle = `${asShow.childCount} season${asShow.childCount !== 1 ? "s" : ""}`;
                } else if (asShow.leafCount) {
                  subtitle = `${asShow.leafCount} episodes`;
                } else if (asShow.year) {
                  subtitle = String(asShow.year);
                }
                return (
                  <PosterCard
                    key={r.ratingKey}
                    ratingKey={r.ratingKey}
                    imageUrl={posterUrl(r.thumb)}
                    title={r.title}
                    subtitle={subtitle}
                    width={230}
                    onClick={() => navigate(`/item/${r.ratingKey}`)}
                  />
                );
              })}
            </HorizontalRow>
          </div>
        )}

        {/* More with [Actor] */}
        {renderMoreWithActors()}

        {/* Fix Match Dialog */}
        {showFixMatch && ratingKey && (
          <FixMatchDialog
            ratingKey={ratingKey}
            currentTitle={movie.title}
            currentYear={movie.year ? String(movie.year) : undefined}
            mediaType="movie"
            onClose={() => setShowFixMatch(false)}
            onMatchApplied={() => {
              // Re-fetch metadata after match is applied
              setItem(null);
              setIsLoading(true);
            }}
          />
        )}
      </div>
    );
  }

  // ── Show Detail ──
  if (item.type === "show") {
    const show = item as PlexShow;
    return (
      <div style={styles.container}>
        {/* Full-page background art */}
        <img
          src={show.art ? artUrl(show.art) : posterUrl(show.thumb)}
          alt=""
          loading="lazy"
          style={show.art ? styles.pageBgArt : styles.pageBgArtFallback}
        />
        <div style={styles.pageBgOverlay} />

        {/* Media info */}
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
                    <span key={g.tag} style={styles.genreTag}>
                      {g.tag}
                    </span>
                  ))}
                </div>
              )}
              {isAdmin && (
                <div style={{
                  ...styles.buttonRow,
                  ...(mobile ? { justifyContent: "center" } : {}),
                }}>
                  <button
                    onClick={() => setShowFixMatch(true)}
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
              {/* Synopsis */}
              {show.summary && (
                <p style={{
                  ...styles.summary,
                  maxWidth: bp === "large" ? "1000px" : "800px",
                  marginTop: "0.25rem",
                }}>{decodeHtmlEntities(show.summary)}</p>
              )}
            </div>
          </div>

        {/* Seasons grid */}
        {seasons.length > 0 && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Seasons</h2>
            <div style={{
              display: "flex",
              flexWrap: "wrap",
              gap: mobile ? "0.75rem" : "1.25rem",
            }}>
              {seasons.map((season) => {
                const fullyWatched = season.leafCount > 0 && season.viewedLeafCount >= season.leafCount;
                const unwatched = season.leafCount - (season.viewedLeafCount ?? 0);
                return (
                  <PosterCard
                    key={season.ratingKey}
                    ratingKey={season.ratingKey}
                    imageUrl={posterUrl(season.thumb)}
                    title={season.title}
                    subtitle={`${season.leafCount} episode${season.leafCount !== 1 ? "s" : ""}`}
                    width={mobile ? 140 : bp === "large" ? 200 : 170}
                    watched={fullyWatched}
                    unwatchedCount={!fullyWatched && unwatched > 0 && unwatched < season.leafCount ? unwatched : undefined}
                    onClick={() => navigate(`/item/${season.ratingKey}`)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Cast & Crew */}
        {renderCastCrew(show.Role, undefined, undefined, show.studio)}

        {/* Extras */}
        {extras.length > 0 && (
          <div style={styles.section}>
            <HorizontalRow title="Extras">
              {extras.map((extra) => (
                <PosterCard
                  key={extra.ratingKey}
                  ratingKey={extra.ratingKey}
                  imageUrl={posterUrl(extra.thumb)}
                  title={extra.title}
                  subtitle={(extra as { subtype?: string }).subtype || "Extra"}
                  width={360}
                  aspectRatio={0.56}
                  onClick={() => navigate(`/play/${extra.ratingKey}`)}
                />
              ))}
            </HorizontalRow>
          </div>
        )}

        {/* Related */}
        {related.length > 0 && (
          <div style={styles.section}>
            <HorizontalRow title="Related Shows">
              {related.map((r) => {
                const asShow = r as { childCount?: number; leafCount?: number; year?: number };
                let subtitle = "";
                if (asShow.childCount) {
                  subtitle = `${asShow.childCount} season${asShow.childCount !== 1 ? "s" : ""}`;
                } else if (asShow.leafCount) {
                  subtitle = `${asShow.leafCount} episodes`;
                } else if (asShow.year) {
                  subtitle = String(asShow.year);
                }
                return (
                  <PosterCard
                    key={r.ratingKey}
                    ratingKey={r.ratingKey}
                    imageUrl={posterUrl(r.thumb)}
                    title={r.title}
                    subtitle={subtitle}
                    width={230}
                    onClick={() => navigate(`/item/${r.ratingKey}`)}
                  />
                );
              })}
            </HorizontalRow>
          </div>
        )}

        {/* More with [Actor] */}
        {renderMoreWithActors()}

        {/* Fix Match Dialog */}
        {showFixMatch && ratingKey && (
          <FixMatchDialog
            ratingKey={ratingKey}
            currentTitle={show.title}
            currentYear={show.year ? String(show.year) : undefined}
            mediaType="show"
            onClose={() => setShowFixMatch(false)}
            onMatchApplied={() => {
              setItem(null);
              setIsLoading(true);
            }}
          />
        )}
      </div>
    );
  }

  // ── Episode Detail ──
  if (item.type === "episode") {
    const ep = item as PlexEpisode;
    const mediaInfo = ep.Media?.[0];
    const epThumbUrl = getImageUrl(server.uri, server.accessToken, ep.thumb, 780, 440);

    // Build structured media details
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
        mediaDetails.push({ label: "Video", value: parts.join(" · ") });
      }
      if (mediaInfo.audioCodec) {
        const channels = mediaInfo.audioChannels > 0
          ? ` · ${mediaInfo.audioChannels === 6 ? "5.1" : mediaInfo.audioChannels === 8 ? "7.1" : `${mediaInfo.audioChannels}ch`}`
          : "";
        mediaDetails.push({ label: "Audio", value: `${mediaInfo.audioCodec.toUpperCase()}${channels}` });
      }
    }

    return (
      <div style={styles.container}>
        {/* Full-page background art */}
        <img
          src={(ep.grandparentArt || ep.art) ? artUrl(ep.grandparentArt || ep.art) : posterUrl(ep.thumb)}
          alt=""
          loading="lazy"
          style={(ep.grandparentArt || ep.art) ? styles.pageBgArt : styles.pageBgArtFallback}
        />
        <div style={styles.pageBgOverlay} />

        {/* Hero — spacious layout matching movie/show pages */}
        <div style={{
          ...styles.heroContent,
          padding: mobile ? "2rem 1.5rem 1.5rem" : "3.5rem 2.5rem 2.5rem",
          ...(mobile ? { flexDirection: "column", alignItems: "center" } : {}),
        }}>
            <img
              src={epThumbUrl}
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
              {/* Show link + season link */}
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
                <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>›</span>
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

              {/* Synopsis */}
              {ep.summary && (
                <p style={{
                  ...styles.summary,
                  maxWidth: bp === "large" ? "800px" : "650px",
                }}>{decodeHtmlEntities(ep.summary)}</p>
              )}

              {/* Play buttons */}
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
                      ▶ Resume from {formatResumeTime(ep.viewOffset)}
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
                    ▶ Play
                  </button>
                )}
                <WatchTogetherButton
                  ratingKey={ep.ratingKey}
                  title={`${ep.grandparentTitle} — ${ep.title}`}
                  mediaType="episode"
                />
                <WatchedToggleButton
                  ratingKey={ep.ratingKey}
                  isWatched={(ep.viewCount ?? 0) > 0}
                  onToggled={refreshItem}
                />
              </div>

              {/* Structured media details (director, writer, video, audio) */}
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

        {/* Chapters */}
        {(() => {
          const chapters: PlexChapter[] =
            ep.Media?.[0]?.Part?.[0]?.Chapter ?? [];
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

        {/* Cast & Crew */}
        {renderCastCrew(ep.Role, ep.Director, ep.Writer)}

        {/* Other episodes in this season */}
        {siblingEpisodes.length > 1 && (
          <div style={styles.section}>
            <HorizontalRow title={`More from ${ep.parentTitle}`}>
              {siblingEpisodes
                .filter((sib) => sib.ratingKey !== ep.ratingKey)
                .map((sib) => (
                  <PosterCard
                    key={sib.ratingKey}
                    ratingKey={sib.ratingKey}
                    imageUrl={episodeThumbUrl(sib.thumb)}
                    title={sib.title}
                    subtitle={`Episode ${sib.index}`}
                    width={280}
                    aspectRatio={0.56}
                    watched={sib.viewCount != null && sib.viewCount > 0}
                    onClick={() => navigate(`/item/${sib.ratingKey}`)}
                  />
                ))}
            </HorizontalRow>
          </div>
        )}

        {/* Extras */}
        {extras.length > 0 && (
          <div style={styles.section}>
            <HorizontalRow title="Extras">
              {extras.map((extra) => (
                <PosterCard
                  key={extra.ratingKey}
                  ratingKey={extra.ratingKey}
                  imageUrl={posterUrl(extra.thumb)}
                  title={extra.title}
                  subtitle={(extra as { subtype?: string }).subtype || "Extra"}
                  width={360}
                  aspectRatio={0.56}
                  onClick={() => navigate(`/play/${extra.ratingKey}`)}
                />
              ))}
            </HorizontalRow>
          </div>
        )}
      </div>
    );
  }

  // __ Season — redirect to parent show with this season pre-selected __
  // ── Season Detail ──
  if (item.type === "season") {
    const season = item as PlexSeason;
    const currentSeasonIdx = siblingSeasons.findIndex(
      (s) => s.ratingKey === season.ratingKey
    );
    const prevSeason = currentSeasonIdx > 0 ? siblingSeasons[currentSeasonIdx - 1] : null;
    const nextSeason = currentSeasonIdx >= 0 && currentSeasonIdx < siblingSeasons.length - 1
      ? siblingSeasons[currentSeasonIdx + 1]
      : null;

    return (
      <div style={styles.container}>
        {/* Background art from parent show */}
        <img
          src={parentShow?.art ? artUrl(parentShow.art) : posterUrl(season.parentThumb || season.thumb)}
          alt=""
          loading="lazy"
          style={parentShow?.art ? styles.pageBgArt : styles.pageBgArtFallback}
        />
        <div style={styles.pageBgOverlay} />

        {/* Hero section — fades on season switch */}
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

        {/* Season navigation arrows */}
        {siblingSeasons.length > 1 && (
          <div style={styles.seasonNav}>
            <button
              onClick={() => prevSeason && switchSeason(prevSeason)}
              disabled={!prevSeason || seasonFading}
              style={{
                ...styles.seasonNavButton,
                opacity: prevSeason ? 1 : 0.3,
                cursor: prevSeason ? "pointer" : "default",
              }}
              title={prevSeason?.title}
            >
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              Season {season.index} of {siblingSeasons.length}
            </span>
            <button
              onClick={() => nextSeason && switchSeason(nextSeason)}
              disabled={!nextSeason || seasonFading}
              style={{
                ...styles.seasonNavButton,
                opacity: nextSeason ? 1 : 0.3,
                cursor: nextSeason ? "pointer" : "default",
              }}
              title={nextSeason?.title}
            >
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}

        {/* Episode count header — fades on season switch */}
        <div style={{
          ...styles.section,
          opacity: seasonFading ? 0 : 1,
          transition: "opacity 0.15s ease",
        }}>
          <h2 style={styles.sectionTitle}>
            {episodes.length} Episode{episodes.length !== 1 ? "s" : ""}
          </h2>

          {/* Episode grid */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: mobile ? "0.75rem" : "1rem",
          }}>
            {episodes.map((ep) => {
              const isWatched = (ep as PlexEpisode & { viewCount?: number }).viewCount != null
                && (ep as PlexEpisode & { viewCount?: number }).viewCount! > 0;
              const airDate = ep.originallyAvailableAt
                ? new Date(ep.originallyAvailableAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
                : null;
              return (
                <button
                  key={ep.ratingKey}
                  onClick={() => navigate(`/item/${ep.ratingKey}`)}
                  style={{
                    ...styles.episodeGridCard,
                    ...(mobile ? { flexDirection: "column" as const } : {}),
                  }}
                >
                  <div style={{
                    ...styles.episodeGridThumbWrap,
                    ...(mobile ? { width: "100%", minWidth: "unset" } : {}),
                  }}>
                    <img
                      src={episodeThumbUrl(ep.thumb)}
                      alt={ep.title}
                      style={styles.episodeGridThumb}
                      loading="lazy"
                    />
                    {isWatched && (
                      <div style={styles.episodeWatchedBadge}>
                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    )}
                    {ep.duration && (
                      <span style={styles.episodeDuration}>{formatDuration(ep.duration)}</span>
                    )}
                  </div>
                  <div style={styles.episodeGridInfo}>
                    <span style={styles.episodeGridNumber}>Episode {ep.index}{airDate ? ` · ${airDate}` : ""}</span>
                    <span style={styles.episodeGridTitle}>{ep.title}</span>
                    {ep.summary && (
                      <span style={styles.episodeSynopsis}>{decodeHtmlEntities(ep.summary)}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
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
  // Spread shared hero/background styles
  ...detailStyles,
  // Page-specific styles
  container: {
    position: "relative",
    paddingBottom: "2rem",
    overflow: "hidden",
  },
  loadingContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4rem",
  },
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

  // Sections
  section: {
    position: "relative",
    zIndex: 1,
    padding: "1rem 1.5rem",
  },
  sectionTitle: {
    fontSize: "1.15rem",
    fontWeight: 600,
    marginBottom: "0.75rem",
  },
  summary: {
    color: "var(--text-secondary)",
    fontSize: "0.95rem",
    lineHeight: 1.6,
    maxWidth: "800px",
  },

  // Rating badges
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

  // Cast & Crew (horizontal scroll with photos)
  castCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "200px",
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
    border: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  castInitials: {
    fontSize: "2.2rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
  },
  castCardName: {
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
  castCardRole: {
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

  // Season navigation
  seasonNav: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    padding: "0 1.5rem 0.5rem",
  },
  seasonNavButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(255,255,255,0.1)",
    border: "1px solid var(--border)",
    borderRadius: "50%",
    width: "36px",
    height: "36px",
    color: "var(--text-primary)",
    cursor: "pointer",
  },

  // Episode grid (season detail)
  episodeGridCard: {
    display: "flex",
    flexDirection: "row",
    background: "transparent",
    border: "none",
    padding: 0,
    color: "var(--text-primary)",
    textAlign: "left",
    cursor: "pointer",
    borderRadius: "8px",
    overflow: "hidden",
    gap: "0.75rem",
  },
  episodeGridThumbWrap: {
    position: "relative",
    width: "240px",
    minWidth: "240px",
    aspectRatio: "16/9",
    borderRadius: "8px",
    overflow: "hidden",
    background: "var(--bg-secondary)",
    flexShrink: 0,
  },
  episodeGridThumb: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  episodeWatchedBadge: {
    position: "absolute",
    top: "6px",
    right: "6px",
    background: "rgba(0,0,0,0.75)",
    borderRadius: "50%",
    width: "28px",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--accent)",
    border: "2px solid rgba(255,255,255,0.15)",
    backdropFilter: "blur(4px)",
  },
  episodeDuration: {
    position: "absolute",
    bottom: "6px",
    right: "6px",
    background: "rgba(0,0,0,0.75)",
    color: "#fff",
    fontSize: "0.7rem",
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: "4px",
    backdropFilter: "blur(4px)",
  },
  episodeGridInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    padding: "0.25rem 0",
    overflow: "hidden",
    flex: 1,
    minWidth: 0,
  },
  episodeGridTitle: {
    fontSize: "0.9rem",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  episodeGridNumber: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  episodeSynopsis: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    lineHeight: 1.4,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    marginTop: "0.15rem",
  },

  // Media info pills
  mediaPill: {
    background: "rgba(255,255,255,0.1)",
    color: "var(--text-secondary)",
    fontSize: "0.75rem",
    fontWeight: 500,
    padding: "3px 10px",
    borderRadius: "4px",
    border: "1px solid rgba(255,255,255,0.08)",
    letterSpacing: "0.3px",
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
