import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { usePlaylists } from "../hooks/usePlaylists";
import { getImageUrl } from "../services/plex-library";
import LibraryGrid from "../components/LibraryGrid";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";

function PlaylistsBrowser() {
  const { server } = useAuth();
  const navigate = useNavigate();
  const { playlists, isLoading, error, retry } = usePlaylists();

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Playlists</h2>

      {error && <ErrorState message={error} onRetry={retry} />}

      {!isLoading && !error && playlists.length > 0 && (
        <p style={styles.count}>
          {playlists.length} playlist{playlists.length !== 1 ? "s" : ""}
        </p>
      )}

      <LibraryGrid>
        {isLoading &&
          Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}

        {playlists.map((playlist) => (
          <PosterCard
            key={playlist.ratingKey}
            ratingKey={playlist.ratingKey}
            imageUrl={posterUrl(playlist.composite || playlist.thumb)}
            title={playlist.title}
            subtitle={`${playlist.leafCount} item${playlist.leafCount !== 1 ? "s" : ""}`}
            onClick={() => navigate(`/playlist/${playlist.ratingKey}`)}
          />
        ))}
      </LibraryGrid>

      {!isLoading && !error && playlists.length === 0 && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <line x1={8} y1={6} x2={21} y2={6} />
              <line x1={8} y1={12} x2={21} y2={12} />
              <line x1={8} y1={18} x2={21} y2={18} />
              <line x1={3} y1={6} x2={3.01} y2={6} />
              <line x1={3} y1={12} x2={3.01} y2={12} />
              <line x1={3} y1={18} x2={3.01} y2={18} />
            </svg>
          }
          title="No playlists"
          subtitle="Video playlists created in Plex will appear here."
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
  count: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    marginBottom: "1rem",
  },
};

export default PlaylistsBrowser;
