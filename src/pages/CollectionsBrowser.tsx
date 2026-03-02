import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useCollections } from "../hooks/useCollections";
import { getImageUrl } from "../services/plex-library";
import HorizontalRow from "../components/HorizontalRow";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";

function CollectionsBrowser() {
  const { server } = useAuth();
  const navigate = useNavigate();
  const { collections, isLoading, error, retry } = useCollections();

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Collections</h2>

      {error && <ErrorState message={error} onRetry={retry} />}

      {isLoading &&
        [1, 2].map((i) => (
          <section key={i} style={styles.section}>
            <div style={styles.skeletonTitle} />
            <div style={styles.skeletonRow}>
              {Array.from({ length: 8 }).map((_, j) => (
                <SkeletonCard key={j} />
              ))}
            </div>
          </section>
        ))}

      {!isLoading &&
        !error &&
        collections.map((group) => (
          <HorizontalRow
            key={group.section.key}
            title={group.section.title}
          >
            {group.items.map((collection) => (
              <PosterCard
                key={collection.ratingKey}
                imageUrl={posterUrl(collection.thumb)}
                title={collection.title}
                subtitle={`${collection.childCount} item${collection.childCount !== 1 ? "s" : ""}`}
                onClick={() => navigate(`/collection/${collection.ratingKey}`)}
              />
            ))}
          </HorizontalRow>
        ))}

      {!isLoading && !error && collections.length === 0 && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x={3} y={3} width={7} height={7} rx={1} />
              <rect x={14} y={3} width={7} height={7} rx={1} />
              <rect x={3} y={14} width={7} height={7} rx={1} />
              <rect x={14} y={14} width={7} height={7} rx={1} />
            </svg>
          }
          title="No collections"
          subtitle="Collections created in Plex will appear here."
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 600,
    marginBottom: "1rem",
  },
  section: {
    marginBottom: "1.75rem",
  },
  skeletonTitle: {
    width: "150px",
    height: "20px",
    borderRadius: "4px",
    background: "var(--border)",
    opacity: 0.3,
    marginBottom: "0.75rem",
  },
  skeletonRow: {
    display: "flex",
    gap: "0.75rem",
    overflow: "hidden",
  },
};

export default CollectionsBrowser;
