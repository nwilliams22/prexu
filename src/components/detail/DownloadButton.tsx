import { useAuth } from "../../hooks/useAuth";
import { useDownloads } from "../../hooks/useDownloads";
import { useToast } from "../../hooks/useToast";
import type { PlexMovie, PlexEpisode, PlexMediaInfo } from "../../types/library";
import type { DownloadItem } from "../../types/downloads";

interface DownloadButtonProps {
  item: PlexMovie | PlexEpisode;
}

function buildDownloadItem(
  item: PlexMovie | PlexEpisode,
  serverUri: string,
): DownloadItem | null {
  const media: PlexMediaInfo | undefined = item.Media?.[0];
  const part = media?.Part?.[0];
  if (!part?.key) return null;

  const isEpisode = item.type === "episode";
  const ep = isEpisode ? (item as PlexEpisode) : null;

  // Extract file name from the part file path or key
  const fileName =
    part.file?.split(/[/\\]/).pop() ??
    `${item.ratingKey}.${part.container || "mp4"}`;

  return {
    ratingKey: item.ratingKey,
    title: item.title,
    subtitle: isEpisode && ep
      ? `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")}`
      : (item as PlexMovie).year
        ? String((item as PlexMovie).year)
        : "",
    type: isEpisode ? "episode" : "movie",
    thumb: item.thumb,
    partKey: part.key,
    fileName,
    fileSize: part.size || 0,
    serverUri,
    status: "queued",
    bytesDownloaded: 0,
    grandparentTitle: ep?.grandparentTitle,
    parentIndex: ep?.parentIndex,
    index: ep?.index,
  };
}

export { buildDownloadItem };

export default function DownloadButton({ item }: DownloadButtonProps) {
  const { server } = useAuth();
  const { isDownloaded, isDownloading, getDownload, queueDownload } =
    useDownloads();
  const { toast } = useToast();

  const rk = item.ratingKey;
  const downloaded = isDownloaded(rk);
  const downloading = isDownloading(rk);
  const dl = getDownload(rk);
  const progress =
    dl && dl.fileSize > 0 ? dl.bytesDownloaded / dl.fileSize : 0;

  const media = item.Media?.[0];
  const part = media?.Part?.[0];

  // Hide if no media part available
  if (!part?.key || !server) return null;

  const handleClick = () => {
    if (downloaded || downloading) return;
    const dlItem = buildDownloadItem(item, server.uri);
    if (!dlItem) return;
    queueDownload(dlItem);
    toast("Download started", "success");
  };

  return (
    <button
      onClick={handleClick}
      disabled={downloaded || downloading}
      style={{
        ...styles.button,
        opacity: downloaded || downloading ? 0.7 : 1,
      }}
      title={
        downloaded
          ? "Downloaded"
          : downloading
            ? `Downloading ${Math.round(progress * 100)}%`
            : "Download for offline"
      }
    >
      {downloaded ? (
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginRight: "0.5rem" }}
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ) : (
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginRight: "0.5rem" }}
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1={12} y1={15} x2={12} y2={3} />
        </svg>
      )}
      {downloaded
        ? "Downloaded"
        : downloading
          ? `${Math.round(progress * 100)}%`
          : "Download"}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.65rem 1.5rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.08)",
    color: "var(--text-primary)",
    cursor: "pointer",
    transition: "opacity 0.15s",
  },
};
