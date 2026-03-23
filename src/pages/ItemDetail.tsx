import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useParentalControls } from "../hooks/useParentalControls";
import { useToast } from "../hooks/useToast";
import { useBreakpoint, isMobile } from "../hooks/useBreakpoint";
import { useItemDetailData } from "../hooks/useItemDetailData";
import { useSeasonSwitch } from "../hooks/useSeasonSwitch";
import { getImageUrl, getPlaceholderUrl, getImageSrcSet } from "../services/plex-library";
import HorizontalRow from "../components/HorizontalRow";
import PosterCard from "../components/PosterCard";
import ErrorState from "../components/ErrorState";
import ItemHeroSection from "../components/detail/ItemHeroSection";
import EpisodeListSection from "../components/detail/EpisodeListSection";
import CastSection from "../components/detail/CastSection";
import AdminActionsBar from "../components/detail/AdminActionsBar";
import RatingsSection from "../components/detail/RatingsSection";
import type {
  PlexMovie,
  PlexShow,
  PlexSeason,
  PlexEpisode,
  PlexChapter,
} from "../types/library";
import { detailStyles } from "../utils/detail-styles";
import { isWatched } from "../utils/media-helpers";
import type { PlexMediaItem } from "../types/library";

function ItemDetail() {
  const { server, activeUser } = useAuth();
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const navigate = useNavigate();
  const isAdmin = activeUser?.isAdmin ?? false;
  const { isItemAllowed, restrictionsEnabled } = useParentalControls();
  const { toast } = useToast();

  const {
    item,
    seasons,
    episodes,
    isLoading,
    error,
    parentShow,
    siblingSeasons,
    siblingEpisodes,
    related,
    extras,
    moreWithActors,
    showFixMatch,
    setShowFixMatch,
    refreshItem,
    setItem,
    setIsLoading,
    setEpisodes,
  } = useItemDetailData();

  const { seasonFading, switchSeason } = useSeasonSwitch(setItem, setEpisodes);

  if (!server) return null;

  const artUrl = (path: string) =>
    getImageUrl(server.uri, server.accessToken, path, 1920, 1080);
  const posterUrl = (path: string) =>
    getImageUrl(server.uri, server.accessToken, path, 300, 450);
  const posterPlaceholder = (path: string) =>
    getPlaceholderUrl(server.uri, server.accessToken, path);
  const posterSrcSet = (path: string) =>
    getImageSrcSet(server.uri, server.accessToken, path, 300);
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
                placeholderUrl={posterPlaceholder(m.thumb)}
                srcSet={posterSrcSet(m.thumb)}
                title={m.title}
                subtitle={subtitle}
                watched={isWatched(m as unknown as PlexMediaItem)}
                width={230}
                onClick={() => navigate(`/item/${m.ratingKey}`)}
              />
            );
          })}
        </HorizontalRow>
      </div>
    ));
  };

  /** Render chapters list (movies and episodes) */
  const renderChapters = (chapters: PlexChapter[]) => {
    if (chapters.length === 0) return null;
    return (
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
    );
  };

  /** Render extras row */
  const renderExtras = () => {
    if (extras.length === 0) return null;
    return (
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
    );
  };

  /** Render related items row */
  const renderRelated = (title = "Related") => {
    if (related.length === 0) return null;
    return (
      <div style={styles.section}>
        <HorizontalRow title={title}>
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
                placeholderUrl={posterPlaceholder(r.thumb)}
                srcSet={posterSrcSet(r.thumb)}
                title={r.title}
                subtitle={subtitle}
                watched={isWatched(r as unknown as PlexMediaItem)}
                width={230}
                onClick={() => navigate(`/item/${r.ratingKey}`)}
              />
            );
          })}
        </HorizontalRow>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div className="loading-spinner" />
      </div>
    );
  }

  // Redirect restricted content
  const itemRating = item ? (item as { contentRating?: string }).contentRating : undefined;
  const restricted = restrictionsEnabled && item && !isItemAllowed(itemRating);

  useEffect(() => {
    if (restricted) {
      toast("This content is restricted on your profile", "error");
      navigate(-1);
    }
  }, [restricted, toast, navigate]);

  if (error || !item) {
    return (
      <div style={styles.container}>
        <ErrorState message={error ?? "Item not found"} />
      </div>
    );
  }

  if (restricted) return null;

  // ── Movie Detail ──
  if (item.type === "movie") {
    const movie = item as PlexMovie;
    const chapters: PlexChapter[] = movie.Media?.[0]?.Part?.[0]?.Chapter ?? [];
    return (
      <div style={styles.container}>
        <ItemHeroSection
          item={movie}
          artUrl={artUrl}
          posterUrl={posterUrl}
          isAdmin={isAdmin}
          onFixMatch={() => setShowFixMatch(true)}
          refreshItem={refreshItem}
        />
        <RatingsSection
          ratings={movie.Rating}
          rating={movie.rating}
          audienceRating={movie.audienceRating}
          ratingImage={movie.ratingImage}
          audienceRatingImage={movie.audienceRatingImage}
        />
        {renderChapters(chapters)}
        <CastSection
          roles={movie.Role}
          directors={movie.Director}
          writers={movie.Writer}
          studio={movie.studio}
          actorThumbUrl={actorThumbUrl}
        />
        {renderExtras()}
        {renderRelated()}
        {renderMoreWithActors()}
        <AdminActionsBar
          showFixMatch={showFixMatch}
          ratingKey={movie.ratingKey}
          currentTitle={movie.title}
          currentYear={movie.year ? String(movie.year) : undefined}
          mediaType="movie"
          onClose={() => setShowFixMatch(false)}
          onMatchApplied={() => {
            setItem(null);
            setIsLoading(true);
          }}
        />
      </div>
    );
  }

  // ── Show Detail ──
  if (item.type === "show") {
    const show = item as PlexShow;
    return (
      <div style={styles.container}>
        <ItemHeroSection
          item={show}
          artUrl={artUrl}
          posterUrl={posterUrl}
          isAdmin={isAdmin}
          onFixMatch={() => setShowFixMatch(true)}
          refreshItem={refreshItem}
        />
        <RatingsSection
          ratings={show.Rating}
          rating={show.rating}
          audienceRating={show.audienceRating}
          ratingImage={show.ratingImage}
          audienceRatingImage={show.audienceRatingImage}
        />

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
                    placeholderUrl={posterPlaceholder(season.thumb)}
                    srcSet={posterSrcSet(season.thumb)}
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

        <CastSection
          roles={show.Role}
          studio={show.studio}
          actorThumbUrl={actorThumbUrl}
        />
        {renderExtras()}
        {renderRelated("Related Shows")}
        {renderMoreWithActors()}
        <AdminActionsBar
          showFixMatch={showFixMatch}
          ratingKey={show.ratingKey}
          currentTitle={show.title}
          currentYear={show.year ? String(show.year) : undefined}
          mediaType="show"
          onClose={() => setShowFixMatch(false)}
          onMatchApplied={() => {
            setItem(null);
            setIsLoading(true);
          }}
        />
      </div>
    );
  }

  // ── Episode Detail ──
  if (item.type === "episode") {
    const ep = item as PlexEpisode;
    const chapters: PlexChapter[] = ep.Media?.[0]?.Part?.[0]?.Chapter ?? [];
    return (
      <div style={styles.container}>
        <ItemHeroSection
          item={ep}
          artUrl={artUrl}
          posterUrl={(path: string) => getImageUrl(server.uri, server.accessToken, path, 780, 440)}
          isAdmin={isAdmin}
          onFixMatch={() => setShowFixMatch(true)}
          refreshItem={refreshItem}
        />
        {renderChapters(chapters)}
        <CastSection
          roles={ep.Role}
          directors={ep.Director}
          writers={ep.Writer}
          actorThumbUrl={actorThumbUrl}
        />

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

        {renderExtras()}
      </div>
    );
  }

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
        <ItemHeroSection
          item={season}
          artUrl={artUrl}
          posterUrl={posterUrl}
          isAdmin={isAdmin}
          onFixMatch={() => setShowFixMatch(true)}
          refreshItem={refreshItem}
          seasonFading={seasonFading}
          parentShow={parentShow}
        />

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

        <EpisodeListSection
          episodes={episodes}
          seasonFading={seasonFading}
          episodeThumbUrl={episodeThumbUrl}
          formatDuration={formatDuration}
        />
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
  ...detailStyles,
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
};

export default ItemDetail;
