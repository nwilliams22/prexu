import { useAuth } from "../hooks/useAuth";
import { useDownloads } from "../hooks/useDownloads";
import { useNavigate } from "react-router-dom";
import { getImageUrl } from "../services/plex-library";
import EmptyState from "../components/EmptyState";
import type { DownloadItem } from "../types/downloads";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function DownloadItemRow({ item, serverUri, serverToken }: {
  item: DownloadItem;
  serverUri: string;
  serverToken: string;
}) {
  const { cancelDownload, deleteDownload, retryDownload } = useDownloads();
  const navigate = useNavigate();
  const progress = item.fileSize > 0 ? item.bytesDownloaded / item.fileSize : 0;
  const thumbUrl = getImageUrl(serverUri, serverToken, item.thumb, 80, 120);

  return (
    <div style={styles.row}>
      <img
        src={thumbUrl}
        alt=""
        style={styles.thumb}
        onClick={() => navigate(`/item/${item.ratingKey}`)}
      />
      <div style={styles.info}>
        <span style={styles.itemTitle}>{item.title}</span>
        <span style={styles.itemSubtitle}>
          {item.grandparentTitle
            ? `${item.grandparentTitle} \u2014 ${item.subtitle}`
            : item.subtitle}
        </span>
        <span style={styles.itemMeta}>
          {item.status === "downloading"
            ? `${formatBytes(item.bytesDownloaded)} / ${formatBytes(item.fileSize)} \u2014 ${Math.round(progress * 100)}%`
            : item.status === "complete"
              ? formatBytes(item.fileSize)
              : item.status === "error"
                ? item.errorMessage ?? "Download failed"
                : item.status === "queued"
                  ? "Waiting..."
                  : "Cancelled"}
        </span>
        {(item.status === "downloading" || item.status === "queued") && (
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressBar,
                width: `${Math.round(progress * 100)}%`,
              }}
            />
          </div>
        )}
      </div>
      <div style={styles.actions}>
        {(item.status === "downloading" || item.status === "queued") && (
          <button
            onClick={() => cancelDownload(item.ratingKey)}
            style={styles.actionBtn}
            title="Cancel download"
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <line x1={18} y1={6} x2={6} y2={18} />
              <line x1={6} y1={6} x2={18} y2={18} />
            </svg>
          </button>
        )}
        {item.status === "complete" && (
          <button
            onClick={() => navigate(`/play/${item.ratingKey}`)}
            style={styles.playBtn}
            title="Play"
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,3 21,12 6,21" />
            </svg>
          </button>
        )}
        {(item.status === "error" || item.status === "cancelled") && (
          <button
            onClick={() => retryDownload(item.ratingKey)}
            style={styles.actionBtn}
            title="Retry download"
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        )}
        <button
          onClick={() => deleteDownload(item.ratingKey)}
          style={styles.actionBtn}
          title="Delete download"
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function Downloads() {
  const { server } = useAuth();
  const { downloads } = useDownloads();

  if (!server) return null;

  const active = downloads.filter(
    (d) => d.status === "downloading" || d.status === "queued",
  );
  const completed = downloads.filter((d) => d.status === "complete");
  const failed = downloads.filter(
    (d) => d.status === "error" || d.status === "cancelled",
  );

  if (downloads.length === 0) {
    return (
      <div style={{ ...styles.container, flex: 1, display: "flex", flexDirection: "column" }}>
        <h2 style={styles.title}>Downloads</h2>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <EmptyState
            icon={
              <svg width={64} height={64} viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1={12} y1={15} x2={12} y2={3} />
              </svg>
            }
            title="No downloads"
            subtitle="Right-click any movie or episode to download it for offline viewing."
          />
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Downloads</h2>

      {active.length > 0 && (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>
            Downloading ({active.length})
          </h3>
          {active.map((item) => (
            <DownloadItemRow
              key={item.ratingKey}
              item={item}
              serverUri={server.uri}
              serverToken={server.accessToken}
            />
          ))}
        </section>
      )}

      {failed.length > 0 && (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>Failed</h3>
          {failed.map((item) => (
            <DownloadItemRow
              key={item.ratingKey}
              item={item}
              serverUri={server.uri}
              serverToken={server.accessToken}
            />
          ))}
        </section>
      )}

      {completed.length > 0 && (
        <section style={styles.section}>
          <h3 style={styles.sectionTitle}>
            Downloaded ({completed.length})
          </h3>
          {completed.map((item) => (
            <DownloadItemRow
              key={item.ratingKey}
              item={item}
              serverUri={server.uri}
              serverToken={server.accessToken}
            />
          ))}
        </section>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
    maxWidth: "800px",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    marginBottom: "1.5rem",
  },
  section: {
    marginBottom: "1.5rem",
  },
  sectionTitle: {
    fontSize: "1.1rem",
    fontWeight: 600,
    color: "var(--accent)",
    marginBottom: "0.75rem",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.5rem 0",
    borderBottom: "1px solid var(--border)",
  },
  thumb: {
    width: 48,
    height: 72,
    borderRadius: 4,
    objectFit: "cover",
    flexShrink: 0,
    cursor: "pointer",
  },
  info: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    minWidth: 0,
  },
  itemTitle: {
    fontSize: "0.9rem",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemSubtitle: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemMeta: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  progressTrack: {
    height: 4,
    background: "rgba(255,255,255,0.1)",
    borderRadius: 2,
    marginTop: "0.25rem",
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    background: "var(--accent)",
    borderRadius: 2,
    transition: "width 0.3s ease",
  },
  actions: {
    display: "flex",
    gap: "0.35rem",
    flexShrink: 0,
  },
  actionBtn: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
  },
  playBtn: {
    background: "var(--accent)",
    color: "#000",
    border: "none",
    borderRadius: 6,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
  },
};

export default Downloads;
