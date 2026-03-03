import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useCollections } from "../hooks/useCollections";
import { getImageUrl } from "../services/plex-library";
import LibraryGrid from "../components/LibraryGrid";
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

      {isLoading && (
        <LibraryGrid>
          {Array.from({ length: 18 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </LibraryGrid>
      )}

      {!isLoading &&
        !error &&
        collections.map((group) => (
          <section key={group.section.key} style={styles.section}>
            <h3 style={styles.sectionTitle}>{group.section.title}</h3>
            <LibraryGrid>
              {group.items.map((collection) => (
                <PosterCard
                  key={collection.ratingKey}
                  imageUrl={posterUrl(collection.thumb)}
                  title={collection.title}
                  subtitle={`${collection.childCount} item${collection.childCount !== 1 ? "s" : ""}`}
                  onClick={() => navigate(`/collection/${collection.ratingKey}`)}
                />
              ))}
            </LibraryGrid>
          </section>
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
    marginBottom: "2rem",
  },
  sectionTitle: {
    fontSize: "1.1rem",
    fontWeight: 600,
    marginBottom: "0.75rem",
    color: "var(--text-primary)",
  },
};

export default CollectionsBrowser;
