import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useBreakpoint, isMobile, isTabletOrBelow } from "../hooks/useBreakpoint";
import { getMediaByActor, searchLibrary, getImageUrl } from "../services/plex-library";
import { getTmdbApiKey } from "../services/storage";
import {
  searchTmdbPerson,
  getTmdbPersonDetail,
  getTmdbPersonCredits,
  getTmdbMovieDetail,
  getTmdbTvDetail,
  getTmdbImageUrl,
  type TmdbPersonDetail,
  type TmdbCreditEntry,
} from "../services/tmdb";
import HorizontalRow from "../components/HorizontalRow";
import PosterCard from "../components/PosterCard";
import type { PlexMediaItem } from "../types/library";

/** Get initials from a name */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "";
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Format date string to readable format */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

/** Calculate age from birthday (and optional deathday) */
function calcAge(birthday: string | null, deathday: string | null): number | null {
  if (!birthday) return null;
  const birth = new Date(birthday + "T00:00:00");
  const end = deathday ? new Date(deathday + "T00:00:00") : new Date();
  let age = end.getFullYear() - birth.getFullYear();
  const m = end.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && end.getDate() < birth.getDate())) age--;
  return age;
}

/** Get year from a date string */
function getYear(dateStr?: string): number {
  if (!dateStr) return 0;
  return parseInt(dateStr.slice(0, 4), 10) || 0;
}

function ActorDetail() {
  const { actorName } = useParams<{ actorName: string }>();
  const { server } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const tablet = isTabletOrBelow(bp) && !mobile;

  const thumbPath = (location.state as { thumb?: string } | null)?.thumb;

  // Plex server media
  const [movies, setMovies] = useState<PlexMediaItem[]>([]);
  const [shows, setShows] = useState<PlexMediaItem[]>([]);
  // Map of lowercase title → PlexMediaItem for all server items (used for "On Server" matching)
  const [serverItemMap, setServerItemMap] = useState<Map<string, PlexMediaItem>>(new Map());

  // TMDB data
  const [personDetail, setPersonDetail] = useState<TmdbPersonDetail | null>(null);
  const [credits, setCredits] = useState<TmdbCreditEntry[]>([]);
  const [knownFor, setKnownFor] = useState<TmdbCreditEntry[]>([]);
  const [bioExpanded, setBioExpanded] = useState(false);

  // Frequent collaborators
  const [collaborators, setCollaborators] = useState<
    { name: string; count: number; profilePath: string | null; sharedTitles: string[] }[]
  >([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server || !actorName) return;
    let cancelled = false;

    document.title = `${actorName} - Prexu`;

    (async () => {
      setIsLoading(true);
      setError(null);
      setBioExpanded(false);

      try {
        // Fetch Plex server media + TMDB data in parallel
        const [plexResult, plexSearchResult, tmdbResult] = await Promise.allSettled([
          // Plex: find their media on this server (uses actor filter across all sections)
          getMediaByActor(server.uri, server.accessToken, actorName),
          // Plex: supplemental hub search to catch voice/guest roles the actor filter misses
          searchLibrary(server.uri, server.accessToken, actorName, 50),
          // TMDB: get person details + credits
          (async () => {
            const apiKey = await getTmdbApiKey();
            if (!apiKey) return null;
            const person = await searchTmdbPerson(apiKey, actorName);
            if (!person) return null;
            const [detail, creds] = await Promise.all([
              getTmdbPersonDetail(apiKey, person.id),
              getTmdbPersonCredits(apiKey, person.id),
            ]);
            return { detail, credits: creds };
          })(),
        ]);

        if (cancelled) return;

        // Process Plex results — merge actor filter + hub search results
        {
          const seen = new Set<string>();
          const movieItems: PlexMediaItem[] = [];
          const showItems: PlexMediaItem[] = [];

          const addItem = (item: PlexMediaItem) => {
            if (seen.has(item.ratingKey)) return;
            seen.add(item.ratingKey);
            if (item.type === "movie") movieItems.push(item);
            else if (item.type === "show") showItems.push(item);
          };

          // Primary: actor filter results
          if (plexResult.status === "fulfilled") {
            for (const item of plexResult.value) addItem(item);
          }

          // Supplemental: hub search results (catches voice/guest roles)
          if (plexSearchResult.status === "fulfilled") {
            for (const hub of plexSearchResult.value) {
              if (hub.Metadata) {
                for (const item of hub.Metadata) {
                  if (item.type === "movie" || item.type === "show") addItem(item);
                }
              }
            }
          }

          // Process TMDB results and build Known For list
          let knownForList: TmdbCreditEntry[] = [];
          if (tmdbResult.status === "fulfilled" && tmdbResult.value) {
            const { detail, credits: creds } = tmdbResult.value;
            if (detail) setPersonDetail(detail);

            if (creds.length > 0) {
              setCredits(creds);
              // Build "Known For" — top entries by popularity, deduped
              const seenTmdb = new Set<number>();
              const sorted = [...creds]
                .filter((c) => c.character && !c.character.includes("Self"))
                .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
              for (const c of sorted) {
                if (seenTmdb.has(c.id)) continue;
                seenTmdb.add(c.id);
                knownForList.push(c);
                if (knownForList.length >= 15) break;
              }
              setKnownFor(knownForList);
            }
          }

          // Cross-reference: search Plex for TMDB credit titles not already in server results
          // This catches shows like The Simpsons where the actor isn't in Plex's actor metadata
          const serverTitleSet = new Set<string>();
          for (const m of movieItems) serverTitleSet.add(m.title.toLowerCase());
          for (const s of showItems) serverTitleSet.add(s.title.toLowerCase());

          const missingTitles = knownForList.filter((c) => {
            const title = (c.title ?? c.name ?? "").toLowerCase();
            return title && !serverTitleSet.has(title);
          });

          if (missingTitles.length > 0 && !cancelled) {
            // Search Plex for each missing title in parallel (max 15 quick searches)
            const titleSearches = await Promise.allSettled(
              missingTitles.map((c) =>
                searchLibrary(server.uri, server.accessToken, c.title ?? c.name ?? "", 5)
              )
            );

            for (let i = 0; i < titleSearches.length; i++) {
              const result = titleSearches[i];
              if (result.status !== "fulfilled") continue;
              const searchTitle = (missingTitles[i].title ?? missingTitles[i].name ?? "").toLowerCase();
              for (const hub of result.value) {
                if (hub.Metadata) {
                  for (const item of hub.Metadata) {
                    // Only add exact title matches to avoid false positives
                    if (
                      item.title.toLowerCase() === searchTitle &&
                      (item.type === "movie" || item.type === "show")
                    ) {
                      addItem(item);
                    }
                  }
                }
              }
            }
          }

          const byYear = (a: PlexMediaItem, b: PlexMediaItem) => {
            const ay = (a as unknown as { year?: number }).year ?? 0;
            const by = (b as unknown as { year?: number }).year ?? 0;
            return by - ay;
          };
          movieItems.sort(byYear);
          showItems.sort(byYear);

          setMovies(movieItems);
          setShows(showItems);

          // Build server title → item map for Known For / Filmography "On Server" matching
          const titleMap = new Map<string, PlexMediaItem>();
          for (const m of movieItems) titleMap.set(m.title.toLowerCase(), m);
          for (const s of showItems) titleMap.set(s.title.toLowerCase(), s);
          setServerItemMap(titleMap);

          // ── Frequent Collaborators ──
          // Fetch TMDB details for the actor's top on-server credits to extract co-star data
          if (!cancelled && knownForList.length > 0) {
            const apiKey = await getTmdbApiKey();
            if (apiKey) {
              // Pick top credits that are on the server, or fall back to top credits overall
              const serverCredits = knownForList.filter((c) =>
                titleMap.has((c.title ?? c.name ?? "").toLowerCase())
              );
              const creditsToFetch = (
                serverCredits.length >= 4 ? serverCredits : knownForList
              ).slice(0, 8);

              const detailResults = await Promise.allSettled(
                creditsToFetch.map((c) =>
                  c.media_type === "movie"
                    ? getTmdbMovieDetail(apiKey, c.id)
                    : getTmdbTvDetail(apiKey, c.id)
                )
              );

              if (!cancelled) {
                // Count co-star appearances across all fetched movies/shows
                const costarCounts = new Map<
                  string,
                  { count: number; profilePath: string | null; titles: string[] }
                >();
                const actorNameLower = actorName.toLowerCase();

                for (let i = 0; i < detailResults.length; i++) {
                  const result = detailResults[i];
                  if (result.status !== "fulfilled" || !result.value) continue;
                  const detail = result.value;
                  const cast = detail.credits?.cast ?? [];
                  const creditTitle =
                    "title" in detail ? detail.title : (detail as { name: string }).name;

                  for (const member of cast.slice(0, 15)) {
                    if (member.name.toLowerCase() === actorNameLower) continue;
                    const existing = costarCounts.get(member.name);
                    if (existing) {
                      existing.count++;
                      existing.titles.push(creditTitle);
                      if (!existing.profilePath && member.profile_path) {
                        existing.profilePath = member.profile_path;
                      }
                    } else {
                      costarCounts.set(member.name, {
                        count: 1,
                        profilePath: member.profile_path,
                        titles: [creditTitle],
                      });
                    }
                  }
                }

                // Keep only people appearing in 2+ titles, sorted by count
                const collabs = [...costarCounts.entries()]
                  .filter(([, v]) => v.count >= 2)
                  .sort((a, b) => b[1].count - a[1].count)
                  .slice(0, 6)
                  .map(([name, v]) => ({
                    name,
                    count: v.count,
                    profilePath: v.profilePath,
                    sharedTitles: v.titles,
                  }));

                setCollaborators(collabs);
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load actor data");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, actorName]);

  // Photo: prefer TMDB profile, fall back to Plex thumb
  const tmdbPhotoUrl = personDetail?.profile_path
    ? getTmdbImageUrl(personDetail.profile_path, "w500")
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

  // Build filmography list (cast credits sorted by year desc, deduped)
  const filmography = (() => {
    const seen = new Set<number>();
    return credits
      .filter((c) => c.character) // only acting credits
      .sort((a, b) => {
        const ya = getYear(a.release_date ?? a.first_air_date);
        const yb = getYear(b.release_date ?? b.first_air_date);
        return yb - ya;
      })
      .filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
  })();

  if (!actorName) return null;

  const bio = personDetail?.biography;
  const bioTruncated = bio && bio.length > 400 && !bioExpanded;
  const bioText = bioTruncated ? bio.slice(0, 400) + "..." : bio;

  const age = personDetail ? calcAge(personDetail.birthday, personDetail.deathday) : null;
  const department = personDetail?.known_for_department ?? "Actor";

  // Featured role: highest-rated server item from credits
  const featuredItem = (() => {
    if (credits.length === 0) return null;
    const serverCredits = credits
      .filter((c) => c.character && serverItemMap.has((c.title ?? c.name ?? "").toLowerCase()))
      .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
    if (serverCredits.length === 0) return null;
    const c = serverCredits[0];
    const title = c.title ?? c.name ?? "";
    const plexItem = serverItemMap.get(title.toLowerCase());
    return { credit: c, title, plexItem };
  })();

  return (
    <div style={styles.container}>
      {/* Hero — photo + name/bio + stats panel */}
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

          {personDetail?.birthday && (
            <p style={styles.metaLine}>
              Born {formatDate(personDetail.birthday)}
              {age !== null && ` (${age} years old)`}
              {personDetail.place_of_birth && ` · ${personDetail.place_of_birth}`}
            </p>
          )}

          {personDetail?.deathday && (
            <p style={styles.metaLine}>Died {formatDate(personDetail.deathday)}</p>
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

        {/* Right sidebar — stats + featured + collaborators (desktop only) */}
        {!mobile && !isLoading && (
          <div style={styles.sidePanel}>
            {/* Quick stats */}
            <div style={styles.statsGrid}>
              {movies.length > 0 && (
                <div style={styles.statCard}>
                  <span style={styles.statNumber}>{movies.length}</span>
                  <span style={styles.statLabel}>
                    {movies.length === 1 ? "Movie" : "Movies"} on Server
                  </span>
                </div>
              )}
              {shows.length > 0 && (
                <div style={styles.statCard}>
                  <span style={styles.statNumber}>{shows.length}</span>
                  <span style={styles.statLabel}>
                    {shows.length === 1 ? "Show" : "Shows"} on Server
                  </span>
                </div>
              )}
              {filmography.length > 0 && (
                <div style={styles.statCard}>
                  <span style={styles.statNumber}>{filmography.length}</span>
                  <span style={styles.statLabel}>Acting Credits</span>
                </div>
              )}
              {knownFor.length > 0 && movies.length === 0 && shows.length === 0 && (
                <div style={styles.statCard}>
                  <span style={styles.statNumber}>{knownFor.length}</span>
                  <span style={styles.statLabel}>Known For</span>
                </div>
              )}
            </div>

            {/* Featured role */}
            {featuredItem && (
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
            )}

            {/* Frequent Collaborators */}
            {collaborators.length > 0 && (
              <div style={styles.collabSection}>
                <div style={styles.collabHeader}>Frequent Collaborators</div>
                <div style={styles.collabList}>
                  {collaborators.map((collab) => {
                    const imgUrl = collab.profilePath
                      ? getTmdbImageUrl(collab.profilePath, "w92")
                      : null;
                    return (
                      <div
                        key={collab.name}
                        style={styles.collabItem}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          navigate(
                            `/actor/${encodeURIComponent(collab.name)}`
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            navigate(
                              `/actor/${encodeURIComponent(collab.name)}`
                            );
                          }
                        }}
                      >
                        {imgUrl ? (
                          <img
                            src={imgUrl}
                            alt={collab.name}
                            style={styles.collabPhoto}
                          />
                        ) : (
                          <div style={styles.collabPhotoFallback}>
                            {getInitials(collab.name)}
                          </div>
                        )}
                        <div style={styles.collabInfo}>
                          <span style={styles.collabName}>{collab.name}</span>
                          <span style={styles.collabCount}>
                            {collab.count} shared {collab.count === 1 ? "title" : "titles"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
          {knownFor.length > 0 && (
            <div style={styles.section}>
              <HorizontalRow title="Known For">
                {knownFor.map((c) => {
                  const title = c.title ?? c.name ?? "";
                  const year = getYear(c.release_date ?? c.first_air_date);
                  const imgUrl = c.poster_path
                    ? getTmdbImageUrl(c.poster_path, "w342")
                    : null;
                  // If this title is on the server, make it clickable
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
                          : () =>
                              navigate(`/discover/${c.media_type}/${c.id}`)
                      }
                    />
                  );
                })}
              </HorizontalRow>
            </div>
          )}

          {/* Movies on Server */}
          {movies.length > 0 && (
            <div style={styles.section}>
              <HorizontalRow title={`Movies on Server (${movies.length})`}>
                {movies.map((m) => {
                  const year = (m as unknown as { year?: number }).year;
                  return (
                    <PosterCard
                      key={m.ratingKey}
                      imageUrl={posterUrl(m.thumb)}
                      title={m.title}
                      subtitle={year ? String(year) : ""}
                      width={200}
                      onClick={() => navigate(`/item/${m.ratingKey}`)}
                    />
                  );
                })}
              </HorizontalRow>
            </div>
          )}

          {/* TV Shows on Server */}
          {shows.length > 0 && (
            <div style={styles.section}>
              <HorizontalRow title={`TV Shows on Server (${shows.length})`}>
                {shows.map((s) => {
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
                      imageUrl={posterUrl(s.thumb)}
                      title={s.title}
                      subtitle={subtitle}
                      width={200}
                      onClick={() => navigate(`/item/${s.ratingKey}`)}
                    />
                  );
                })}
              </HorizontalRow>
            </div>
          )}

          {/* Filmography (from TMDB) */}
          {filmography.length > 0 && (
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>Filmography</h2>
              <div style={styles.filmographyList}>
                {filmography.map((c) => {
                  const title = c.title ?? c.name ?? "";
                  const year = getYear(c.release_date ?? c.first_air_date);
                  const serverItem = serverItemMap.get(title.toLowerCase()) ?? null;
                  const onServer = !!serverItem;
                  const handleClick = serverItem
                    ? () => navigate(`/item/${serverItem.ratingKey}`)
                    : () => navigate(`/discover/${c.media_type}/${c.id}`);
                  return (
                    <div
                      key={`film-${c.id}-${c.media_type}`}
                      style={{
                        ...styles.filmographyRow,
                        cursor: "pointer",
                      }}
                      onClick={handleClick}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleClick();
                        }
                      }}
                    >
                      <span style={styles.filmYear}>
                        {year || "—"}
                      </span>
                      <span style={styles.filmTitle}>{title}</span>
                      {c.character && (
                        <span style={styles.filmRole}>
                          {" "}
                          · as {c.character}
                        </span>
                      )}
                      {onServer ? (
                        <span style={styles.onServerBadge}>On Server</span>
                      ) : (
                        <span style={styles.requestBadge}>Request</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state — no data at all */}
          {movies.length === 0 &&
            shows.length === 0 &&
            knownFor.length === 0 &&
            filmography.length === 0 && (
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
  collabSection: {
    background: "var(--bg-card)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    overflow: "hidden",
  },
  collabHeader: {
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    padding: "0.5rem 0.75rem",
    borderBottom: "1px solid var(--border)",
  },
  collabList: {
    display: "flex",
    flexDirection: "column",
  },
  collabItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.5rem 0.75rem",
    cursor: "pointer",
    transition: "background 0.15s ease",
    borderBottom: "1px solid var(--border)",
  },
  collabPhoto: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  collabPhotoFallback: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "var(--bg-secondary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.65rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  collabInfo: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    flex: 1,
  },
  collabName: {
    fontSize: "0.8rem",
    fontWeight: 500,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  collabCount: {
    fontSize: "0.7rem",
    color: "var(--text-secondary)",
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
  sectionTitle: {
    fontSize: "1.25rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: "0 0 1rem 0",
  },
  filmographyList: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    maxWidth: "800px",
  },
  filmographyRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.6rem 0.75rem",
    borderRadius: "6px",
    fontSize: "0.9rem",
    transition: "background 0.15s",
  },
  filmYear: {
    width: "40px",
    flexShrink: 0,
    color: "var(--text-secondary)",
    fontWeight: 500,
    fontSize: "0.85rem",
  },
  filmTitle: {
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  filmRole: {
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
  },
  onServerBadge: {
    marginLeft: "auto",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--accent)",
    flexShrink: 0,
  },
  requestBadge: {
    marginLeft: "auto",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    flexShrink: 0,
    opacity: 0.6,
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
