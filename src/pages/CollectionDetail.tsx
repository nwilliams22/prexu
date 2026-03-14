import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useMediaContextMenu } from "../hooks/useMediaContextMenu";
import { usePlayAction } from "../hooks/usePlayAction";
import {
  getItemMetadata,
  getCollectionItems,
  getImageUrl,
} from "../services/plex-library";
import LibraryGrid from "../components/LibraryGrid";
import PosterCard from "../components/PosterCard";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import type { PlexMediaItem, PlexShow } from "../types/library";

function CollectionDetail() {
  const { collectionKey } = useParams<{ collectionKey: string }>();
  const { server } = useAuth();
  const navigate = useNavigate();
  const { openContextMenu, overlays: menuOverlays } = useMediaContextMenu();
  const { getPlayHandler, playOverlay } = usePlayAction();
  const [collectionTitle, setCollectionTitle] = useState("");
  const [collectionSummary, setCollectionSummary] = useState("");
  const [items, setItems] = useState<PlexMediaItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server || !collectionKey) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch collection metadata for title/summary
        const meta = await getItemMetadata<PlexMediaItem>(
          server.uri,
          server.accessToken,
          collectionKey
        );
        if (!cancelled) {
          setCollectionTitle(meta.title);
          setCollectionSummary(meta.summary || "");
        }

        // Fetch collection items
        const result = await getCollectionItems(
          server.uri,
          server.accessToken,
          collectionKey
        );
        if (!cancelled) {
          setItems(result.items);
          setTotalSize(result.totalSize);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load collection"
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [server, collectionKey]);

  useEffect(() => {
    if (collectionTitle) document.title = `${collectionTitle} - Prexu`;
  }, [collectionTitle]);

  if (!server) return null;

  const posterUrl = (thumb: string) =>
    getImageUrl(server.uri, server.accessToken, thumb, 300, 450);

  const getSubtitle = (item: PlexMediaItem): string => {
    if (item.type === "show") {
      const show = item as PlexShow;
      const parts: string[] = [];
      if (show.year) parts.push(String(show.year));
      if (show.leafCount) parts.push(`${show.leafCount} eps`);
      return parts.join(" · ");
    }
    const withYear = item as { year?: number };
    if (withYear.year) return String(withYear.year);
    return "";
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>{collectionTitle || "Collection"}</h2>

      {collectionSummary && !isLoading && (
        <p style={styles.summary}>{collectionSummary}</p>
      )}

      {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}

      {!isLoading && !error && totalSize > 0 && (
        <p style={styles.count}>
          {totalSize.toLocaleString()} item{totalSize !== 1 ? "s" : ""}
        </p>
      )}

      <LibraryGrid>
        {isLoading &&
          Array.from({ length: 24 }).map((_, i) => <SkeletonCard key={i} />)}

        {items.map((item) => (
          <PosterCard
            key={item.ratingKey}
            imageUrl={posterUrl(item.thumb)}
            title={item.title}
            subtitle={getSubtitle(item)}
            onClick={() => navigate(`/item/${item.ratingKey}`)}
            onPlay={getPlayHandler(item)}
            showMoreButton
            onContextMenu={(e) => openContextMenu(e, item)}
            onMoreClick={(e) => openContextMenu(e, item)}
          />
        ))}
      </LibraryGrid>

      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          icon={
            <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x={3} y={3} width={7} height={7} rx={1} />
              <rect x={14} y={3} width={7} height={7} rx={1} />
              <rect x={3} y={14} width={7} height={7} rx={1} />
              <rect x={14} y={14} width={7} height={7} rx={1} />
            </svg>
          }
          title="Empty collection"
          subtitle="This collection doesn't have any items yet."
          action={{ label: "Back to Collections", onClick: () => navigate("/collections") }}
        />
      )}

      {menuOverlays}
      {playOverlay}
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
    marginBottom: "0.5rem",
  },
  summary: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    maxWidth: "600px",
    marginBottom: "1rem",
  },
  count: {
    fontSize: "0.9rem",
    color: "var(--text-secondary)",
    marginBottom: "1rem",
  },
};

export default CollectionDetail;
