import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useDashboard } from "../hooks/useDashboard";
import { getImageUrl } from "../services/plex-library";
import HorizontalRow from "../components/HorizontalRow";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import type { PlexMediaItem, PlexEpisode } from "../types/library";

function Dashboard() {
  const { server } = useAuth();
  const { recentlyAdded, onDeck, isLoading, error } = useDashboard();
  const navigate = useNavigate();

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  const thumbUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 400, 225);

  const getSubtitle = (item: PlexMediaItem): string => {
    if (item.type === "movie") {
      const movie = item as { year?: number };
      return movie.year ? String(movie.year) : "";
    }
    if (item.type === "episode") {
      const ep = item as PlexEpisode;
      return `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")}`;
    }
    return "";
  };

  const getProgress = (item: PlexMediaItem): number | undefined => {
    const withOffset = item as { viewOffset?: number; duration?: number };
    if (withOffset.viewOffset && withOffset.duration) {
      return withOffset.viewOffset / withOffset.duration;
    }
    return undefined;
  };

  if (error) {
    return (
      <div style={styles.container}>
        <p style={styles.error}>{error}</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Recently Added */}
      {isLoading ? (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Recently Added</h3>
          <div style={styles.skeletonRow}>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </section>
      ) : (
        recentlyAdded.length > 0 && (
          <HorizontalRow title="Recently Added">
            {recentlyAdded.map((group) => (
              <PosterCard
                key={group.groupKey}
                imageUrl={posterUrl(group.thumb)}
                title={group.title}
                subtitle={
                  group.kind === "show-group"
                    ? `${group.episodeCount} episode${group.episodeCount !== 1 ? "s" : ""}`
                    : (group.representativeItem as { year?: number }).year
                      ? String(
                          (group.representativeItem as { year?: number }).year
                        )
                      : ""
                }
                badge={
                  group.kind === "show-group" && group.episodeCount > 1
                    ? `+${group.episodeCount}`
                    : undefined
                }
                onClick={() =>
                  navigate(
                    group.kind === "show-group"
                      ? `/item/${group.groupKey}`
                      : `/item/${group.representativeItem.ratingKey}`
                  )
                }
              />
            ))}
          </HorizontalRow>
        )
      )}

      {/* On Deck / Continue Watching */}
      {isLoading ? (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Continue Watching</h3>
          <div style={styles.skeletonRow}>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} width={200} aspectRatio={0.5625} />
            ))}
          </div>
        </section>
      ) : (
        onDeck.length > 0 && (
          <HorizontalRow title="Continue Watching">
            {onDeck.map((item) => (
              <PosterCard
                key={item.ratingKey}
                imageUrl={thumbUrl(item.thumb)}
                title={item.title}
                subtitle={getSubtitle(item)}
                width={200}
                aspectRatio={0.5625}
                progress={getProgress(item)}
                onClick={() => navigate(`/item/${item.ratingKey}`)}
              />
            ))}
          </HorizontalRow>
        )
      )}

      {/* Empty state */}
      {!isLoading && recentlyAdded.length === 0 && onDeck.length === 0 && (
        <div style={styles.emptyState}>
          <p>No recent activity. Add some media to your Plex libraries!</p>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
  },
  section: {
    marginBottom: "1.75rem",
  },
  sectionTitle: {
    fontSize: "1.15rem",
    fontWeight: 600,
    marginBottom: "0.75rem",
  },
  skeletonRow: {
    display: "flex",
    gap: "0.75rem",
    overflow: "hidden",
  },
  error: {
    color: "var(--error)",
    fontSize: "0.9rem",
    padding: "2rem",
  },
  emptyState: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4rem 2rem",
    color: "var(--text-secondary)",
  },
};

export default Dashboard;
