import { useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useBreakpoint, isMobile, isTabletOrBelow } from "../hooks/useBreakpoint";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { useTmdbPersonData } from "../hooks/useTmdbPersonData";
import { usePlexActorMedia } from "../hooks/usePlexActorMedia";
import { useFrequentCollaborators } from "../hooks/useFrequentCollaborators";
import { calcAge, getYear } from "../utils/actor-helpers";
import { getImageUrl } from "../services/plex-library";
import { getTmdbImageUrl, type TmdbCreditEntry } from "../services/tmdb";
import HorizontalRow from "../components/HorizontalRow";
import PosterCard from "../components/PosterCard";
import ActorCreditsSection from "../components/actor/ActorCreditsSection";
import ActorCollaboratorsSection from "../components/actor/ActorCollaboratorsSection";
import type { PlexMediaItem } from "../types/library";
import { getInitials, formatDate } from "../utils/text-format";
import { isWatched } from "../utils/media-helpers";

function ActorDetail() {
  const { actorName } = useParams<{ actorName: string }>();
  const { server } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const tablet = isTabletOrBelow(bp) && !mobile;
  useScrollRestoration();

  const thumbPath = (location.state as { thumb?: string } | null)?.thumb;

  const [bioExpanded, setBioExpanded] = useState(false);

  // Set document title
  if (actorName) {
    document.title = `${actorName} - Prexu`;
  }

  // ── Data hooks ──
  const tmdb = useTmdbPersonData(actorName);
  const plex = usePlexActorMedia(
    server?.uri,
    server?.accessToken,
    actorName,
    tmdb.knownFor,
    !tmdb.isLoading,
  );
  const collaborators = useFrequentCollaborators(
    actorName,
    tmdb.knownFor,
    plex.serverItemMap,
    !plex.isLoading,
  );

  const isLoading = tmdb.isLoading || plex.isLoading;
  const error = tmdb.error ?? plex.error;

  // Photo: prefer TMDB profile, fall back to Plex thumb
  const tmdbPhotoUrl = tmdb.personDetail?.profile_path
    ? getTmdbImageUrl(tmdb.personDetail.profile_path, "w500")
    : null;
  const plexPhotoUrl =
    thumbPath && server
      ? getImageUrl(server.uri, server.accessToken, thumbPath, 440, 440)
      : null;
  const photoUrl = tmdbPhotoUrl ?? plexPhotoUrl;

  const posterUrl = (path?: string) =>
    path && server
      ? getImageUrl(server.uri, server.accessToken, path, 300, 450)
      : "";

  const photoSize = mobile ? 140 : tablet ? 200 : 260;

  // Build filmography count for stats
  const filmographyCount = (() => {
    const seen = new Set<number>();
    return tmdb.credits
      .filter((c) => c.character)
      .filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      }).length;
  })();

  if (!actorName) return null;

  const bio = tmdb.personDetail?.biography;
  const bioTruncated = bio && bio.length > 400 && !bioExpanded;
  const bioText = bioTruncated ? bio.slice(0, 400) + "..." : bio;

  const age = tmdb.personDetail ? calcAge(tmdb.personDetail.birthday, tmdb.personDetail.deathday) : null;
  const department = tmdb.personDetail?.known_for_department ?? "Actor";

  // Featured role: highest-rated server item from credits
  const featuredItem = (() => {
    if (tmdb.credits.length === 0) return null;
    const serverCredits = tmdb.credits
      .filter((c) => c.character && plex.serverItemMap.has((c.title ?? c.name ?? "").toLowerCase()))
      .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
    if (serverCredits.length === 0) return null;
    const c = serverCredits[0];
    const title = c.title ?? c.name ?? "";
    const plexItem = plex.serverItemMap.get(title.toLowerCase());
    return { credit: c, title, plexItem };
  })();

  return (
    <div style={styles.container}>
      {/* Hero -- photo + name/bio + stats panel */}
      <div style={{ ...styles.hero, flexDirection: mobile ? "column" : "row" }}>
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={actorName}
            style={{ ...styles.photo, width: photoSize, height: photoSize }}
          />
        ) : (
          <div
            style={{
              ...styles.photoFallback,
              width: photoSize,
              height: photoSize,
              fontSize: photoSize * 0.35,
            }}
          >
            {getInitials(actorName)}
          </div>
        )}

        <div style={styles.heroInfo}>
          <h1 style={styles.name}>{actorName}</h1>
          <p style={styles.department}>{department}</p>

          {tmdb.personDetail?.birthday && (
            <p style={styles.metaLine}>
              Born {formatDate(tmdb.personDetail.birthday)}
              {age !== null && ` (${age} years old)`}
              {tmdb.personDetail.place_of_birth && ` · ${tmdb.personDetail.place_of_birth}`}
            </p>
          )}

          {tmdb.personDetail?.deathday && (
            <p style={styles.metaLine}>Died {formatDate(tmdb.personDetail.deathday)}</p>
          )}

          {bioText && (
            <div style={styles.bioContainer}>
              <p style={styles.bio}>{bioText}</p>
              {bio && bio.length > 400 && (
                <button
                  style={styles.moreButton}
                  onClick={() => setBioExpanded(!bioExpanded)}
                >
                  {bioExpanded ? "Show Less" : "Read More"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right sidebar -- stats + featured + collaborators (desktop only) */}
        {!mobile && !isLoading && (
          <div style={styles.sidePanel}>
            {/* Quick stats */}
            <div style={styles.statsGrid}>
              {plex.movies.length > 0 && (
                <div style={styles.statCard}>
                  <span style={styles.statNumber}>{plex.movies.length}</span>
                  <span style={styles.statLabel}>
                    {plex.movies.length === 1 ? "Movie" : "Movies"} on Server
                  </span>
                </div>
              )}
              {plex.shows.length > 0 && (
                <div style={styles.statCard}>
                  <span style={styles.statNumber}>{plex.shows.length}</span>
                  <span style={styles.statLabel}>
                    {plex.shows.length === 1 ? "Show" : "Shows"} on Server
                  </span>
                </div>
              )}
              {filmographyCount > 0 && (
                <div style={styles.statCard}>
                  <span style={styles.statNumber}>{filmographyCount}</span>
                  <span style={styles.statLabel}>Acting Credits</span>
                </div>
              )}
              {tmdb.knownFor.length > 0 && plex.movies.length === 0 && plex.shows.length === 0 && (
                <div style={styles.statCard}>
                  <span style={styles.statNumber}>{tmdb.knownFor.length}</span>
                  <span style={styles.statLabel}>Known For</span>
                </div>
              )}
            </div>

            {/* Featured role */}
            {featuredItem && (
              <FeaturedRoleCard featuredItem={featuredItem} navigate={navigate} />
            )}

            {/* Frequent Collaborators */}
            <ActorCollaboratorsSection collaborators={collaborators} />
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={styles.loadingContainer}>
          <div className="loading-spinner" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={styles.errorContainer}>
          <p style={{ color: "var(--error)" }}>{error}</p>
        </div>
      )}

      {/* Content */}
      {!isLoading && !error && (
        <>
          {/* Known For (from TMDB) */}
          {tmdb.knownFor.length > 0 && (
            <KnownForRow
              knownFor={tmdb.knownFor}
              serverItemMap={plex.serverItemMap}
              navigate={navigate}
            />
          )}

          {/* Movies on Server */}
          {plex.movies.length > 0 && (
            <div style={styles.section}>
              <HorizontalRow title={`Movies on Server (${plex.movies.length})`}>
                {plex.movies.map((m) => {
                  const year = (m as unknown as { year?: number }).year;
                  return (
                    <PosterCard
                      key={m.ratingKey}
                      ratingKey={m.ratingKey}
                      imageUrl={posterUrl(m.thumb)}
                      title={m.title}
                      subtitle={year ? String(year) : ""}
                      watched={isWatched(m as unknown as PlexMediaItem)}
                      width={200}
                      onClick={() => navigate(`/item/${m.ratingKey}`)}
                    />
                  );
                })}
              </HorizontalRow>
            </div>
          )}

          {/* TV Shows on Server */}
          {plex.shows.length > 0 && (
            <div style={styles.section}>
              <HorizontalRow title={`TV Shows on Server (${plex.shows.length})`}>
                {plex.shows.map((s) => {
                  const meta = s as unknown as {
                    year?: number;
                    childCount?: number;
                  };
                  let subtitle = "";
                  if (meta.childCount) {
                    subtitle = `${meta.childCount} season${meta.childCount !== 1 ? "s" : ""}`;
                  } else if (meta.year) {
                    subtitle = String(meta.year);
                  }
                  return (
                    <PosterCard
                      key={s.ratingKey}
                      ratingKey={s.ratingKey}
                      imageUrl={posterUrl(s.thumb)}
                      title={s.title}
                      subtitle={subtitle}
                      watched={isWatched(s as unknown as PlexMediaItem)}
                      width={200}
                      onClick={() => navigate(`/item/${s.ratingKey}`)}
                    />
                  );
                })}
              </HorizontalRow>
            </div>
          )}

          {/* Filmography (from TMDB) */}
          <ActorCreditsSection
            credits={tmdb.credits}
            serverItemMap={plex.serverItemMap}
          />

          {/* Empty state */}
          {plex.movies.length === 0 &&
            plex.shows.length === 0 &&
            tmdb.knownFor.length === 0 &&
            filmographyCount === 0 && (
              <div style={styles.emptyContainer}>
                <p style={{ color: "var(--text-secondary)" }}>
                  No information found for {actorName}.
                </p>
              </div>
            )}
        </>
      )}
    </div>
  );
}

export default ActorDetail;

// ── Small inline sub-components ──

function KnownForRow({
  knownFor,
  serverItemMap,
  navigate,
}: {
  knownFor: TmdbCreditEntry[];
  serverItemMap: Map<string, PlexMediaItem>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div style={styles.section}>
      <HorizontalRow title="Known For">
        {knownFor.map((c) => {
          const title = c.title ?? c.name ?? "";
          const year = getYear(c.release_date ?? c.first_air_date);
          const imgUrl = c.poster_path
            ? getTmdbImageUrl(c.poster_path, "w342")
            : null;
          const serverItem = serverItemMap.get(title.toLowerCase()) ?? null;
          return (
            <PosterCard
              key={`kf-${c.id}-${c.media_type}`}
              imageUrl={imgUrl ?? ""}
              title={title}
              subtitle={
                (c.character ? c.character : c.media_type === "tv" ? "TV" : "") +
                (year ? ` · ${year}` : "")
              }
              width={200}
              onClick={
                serverItem
                  ? () => navigate(`/item/${serverItem.ratingKey}`)
                  : () => navigate(`/discover/${c.media_type}/${c.id}`)
              }
            />
          );
        })}
      </HorizontalRow>
    </div>
  );
}

function FeaturedRoleCard({
  featuredItem,
  navigate,
}: {
  featuredItem: {
    credit: TmdbCreditEntry;
    title: string;
    plexItem: PlexMediaItem | undefined;
  };
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div
      style={styles.featuredCard}
      role="button"
      tabIndex={0}
      onClick={() =>
        featuredItem.plexItem
          ? navigate(`/item/${featuredItem.plexItem.ratingKey}`)
          : undefined
      }
      onKeyDown={(e) => {
        if (
          (e.key === "Enter" || e.key === " ") &&
          featuredItem.plexItem
        ) {
          e.preventDefault();
          navigate(`/item/${featuredItem.plexItem.ratingKey}`);
        }
      }}
    >
      <div style={styles.featuredHeader}>Top Rated Role</div>
      <div style={styles.featuredBody}>
        {featuredItem.credit.poster_path && (
          <img
            src={getTmdbImageUrl(featuredItem.credit.poster_path, "w92") ?? ""}
            alt=""
            style={styles.featuredPoster}
          />
        )}
        <div style={styles.featuredInfo}>
          <span style={styles.featuredTitle}>{featuredItem.title}</span>
          {featuredItem.credit.character && (
            <span style={styles.featuredRole}>
              as {featuredItem.credit.character}
            </span>
          )}
          {featuredItem.credit.vote_average > 0 && (
            <span style={styles.featuredRating}>
              ★ {featuredItem.credit.vote_average.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Styles ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "2rem 1.5rem",
    width: "100%",
    boxSizing: "border-box",
  },
  hero: {
    display: "flex",
    alignItems: "flex-start",
    gap: "2rem",
    marginBottom: "2rem",
  },
  photo: {
    borderRadius: "50%",
    objectFit: "cover",
    background: "var(--bg-secondary)",
    boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
    flexShrink: 0,
  },
  photoFallback: {
    borderRadius: "50%",
    background: "var(--bg-card)",
    border: "2px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  heroInfo: {
    flex: 1,
    minWidth: 0,
    paddingTop: "0.5rem",
  },
  sidePanel: {
    width: "280px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.5rem",
  },
  statCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "0.75rem 0.5rem",
    background: "var(--bg-card)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
  },
  statNumber: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "var(--accent)",
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
    textAlign: "center",
    marginTop: "0.15rem",
  },
  featuredCard: {
    background: "var(--bg-card)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    overflow: "hidden",
    cursor: "pointer",
    transition: "border-color 0.2s ease",
  },
  featuredHeader: {
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    padding: "0.5rem 0.75rem",
    borderBottom: "1px solid var(--border)",
  },
  featuredBody: {
    display: "flex",
    gap: "0.6rem",
    padding: "0.6rem 0.75rem",
  },
  featuredPoster: {
    width: "46px",
    height: "69px",
    borderRadius: "4px",
    objectFit: "cover",
    flexShrink: 0,
  },
  featuredInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    overflow: "hidden",
    flex: 1,
  },
  featuredTitle: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  featuredRole: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  featuredRating: {
    fontSize: "0.75rem",
    color: "var(--accent)",
    fontWeight: 600,
    marginTop: "0.1rem",
  },
  name: {
    fontSize: "2.2rem",
    fontWeight: 700,
    margin: 0,
    color: "var(--text-primary)",
    lineHeight: 1.2,
  },
  department: {
    fontSize: "1rem",
    color: "var(--text-secondary)",
    margin: "0.25rem 0 0.75rem 0",
  },
  metaLine: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    margin: "0.25rem 0",
    lineHeight: 1.5,
  },
  bioContainer: {
    marginTop: "0.75rem",
  },
  bio: {
    fontSize: "0.95rem",
    color: "var(--text-primary)",
    lineHeight: 1.7,
    margin: 0,
    opacity: 0.9,
  },
  moreButton: {
    background: "none",
    border: "none",
    color: "var(--accent)",
    fontSize: "0.9rem",
    cursor: "pointer",
    padding: "0.25rem 0",
    marginTop: "0.25rem",
    fontWeight: 600,
  },
  section: {
    marginBottom: "2rem",
  },
  loadingContainer: {
    display: "flex",
    justifyContent: "center",
    padding: "3rem 0",
  },
  errorContainer: {
    display: "flex",
    justifyContent: "center",
    padding: "2rem 0",
  },
  emptyContainer: {
    display: "flex",
    justifyContent: "center",
    padding: "2rem 0",
  },
};
